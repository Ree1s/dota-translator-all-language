// Turning a batch of chat lines into English with Gemini.
//
// The pure halves (the request, and reading the reply) are exported so
// test.js can cover them without a key; askGemini is the one impure
// function and throws on anything that is not a usable reply.

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const MODEL = 'gemini-3.5-flash-lite';

// Written for game chat on purpose. A general translator turns "го рошан"
// into "go Roshan" well enough but mangles the shorthand people actually
// type, and a polite rewrite of an insult is a mistranslation: what was
// said is the thing being asked for.
export const SYSTEM = [
  'You translate Dota 2 in-game chat into English. Most of it is Russian; some is Chinese.',
  'The input is a JSON array of {i, name, text}. Answer with a JSON array of {i, en}, one entry per input, same i values.',
  'Rules:',
  '- Translate only the text. Never translate or change a player name.',
  '- Keep it short and plain, the way the line would be typed in English.',
  '- Dota shorthand stays shorthand: mid, top, bot, gank, ward, roshan, bkb, tp, gg, ff, ss/miss, rune, stack, push, def, rosh, smoke, buyback, courier.',
  '- Translate insults and swearing as they are. Do not soften, censor or explain them.',
  '- Transliterated Russian typed in Latin letters is still Russian: translate it.',
  '- Chinese is often a pasted voice line or a meme: translate what it says, briefly, and do not explain it.',
  '- If a line is already English, or is only emotes, numbers or punctuation, return it unchanged.',
  '- Numbers, timings and item counts stay exactly as typed.',
  '- Never add commentary, notes or quotation marks. Use "-" instead of a dash character.',
].join('\n');

export function buildRequest(items, { system = SYSTEM } = {}) {
  const input = items.map((it, n) => ({
    i: typeof it.i === 'number' ? it.i : n,
    name: String(it.name || '').slice(0, 32),
    text: String(it.text || '').slice(0, 400),
  }));
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { i: { type: 'INTEGER' }, en: { type: 'STRING' } },
          required: ['i', 'en'],
        },
      },
    },
  };
}

export function replyTextFrom(data) {
  const parts = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

// Tolerant on purpose: a line the model dropped or renumbered should cost
// that one line, never the batch. Returns a Map of index to English.
export function translationsFrom(text) {
  const out = new Map();
  let parsed = null;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    const at = String(text || '').indexOf('[');       // a model that wrapped it in prose
    const end = String(text || '').lastIndexOf(']');
    if (at >= 0 && end > at) {
      try { parsed = JSON.parse(String(text).slice(at, end + 1)); } catch { /* give up */ }
    }
  }
  if (!Array.isArray(parsed)) return out;
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const i = Number(row.i);
    const en = typeof row.en === 'string' ? row.en.trim() : '';
    if (Number.isInteger(i) && en) out.set(i, en);
  }
  return out;
}

export async function askGemini({ apiKey, model = MODEL, request, fetchImpl = globalThis.fetch, timeoutMs = 12000 }) {
  if (!apiKey) throw new Error('no Gemini API key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // The clock runs until the BODY has been read, not until the headers
  // arrive. It used to stop at the headers, and a reply whose body then
  // stalled was waited for without end: SEEN in the overlay - a line shown
  // as said and never translated, not even as a failure, while a call made
  // by hand answered in 0.8s. Three of those and every later line in the
  // match sat behind them for good, which the user saw as "it worked at
  // the start, then stopped".
  let res, data = null;
  try {
    res = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    try { data = await res.json(); } catch (err) { if (err && err.name === 'AbortError') throw err; /* no body */ }
  } catch (err) {
    throw new Error(err && err.name === 'AbortError' ? 'the model took too long' : 'could not reach the model');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `http ${res.status}`);
  return replyTextFrom(data);
}

// A call that never arrived is worth making once more; a call that was
// ANSWERED is not. MEASURED on the first live game this ever read: of two
// lines, one came back in about a second and the other timed out at 12s
// and went up untranslated - so a transport failure is not the rare case
// it would be comfortable to treat it as. Only the two failures that mean
// "nothing happened" are retried, and only once: a refusal, a bad key or
// a quota answer is the model's word and repeating it just spends
// another one.
const WORTH_RETRYING = ['the model took too long', 'could not reach the model'];

// A call is quick or it is lost, so a slow one is not waited for: it is
// RACED. MEASURED, single-line calls to gemini-3.5-flash-lite: 0.7-1.0s,
// or no answer at all - about one in six. It used to be given 2.5s and
// then tried again for 8, and on the live game one line lost BOTH and
// went up untranslated 10.6 seconds after it was said. Now, if nothing
// has come back by HEDGE_AFTER_MS, the same request goes out again
// beside the first, and once more after that; whichever answers first
// is the answer. A lost call costs about a second instead of ten, and
// the price is one extra call for roughly every sixth line.
//
// An attempt that FAILS outright (unreachable, timed out) is replaced at
// once rather than at the next hedge. An attempt that is ANSWERED with a
// refusal ends the whole thing: that is the model's word, see above.
export const HEDGE_AFTER_MS = 1300;
export const ATTEMPT_MS = 6000;
export const MAX_ATTEMPTS = 3;

export function askGeminiHedged(opts, { hedgeAfterMs = HEDGE_AFTER_MS, attempts = MAX_ATTEMPTS, ask = askGemini } = {}) {
  return new Promise((resolve, reject) => {
    let started = 0, failed = 0, settled = false, timer = null, lastError = null;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(deadline); fn(value); };
    // Whatever an attempt does or fails to do, this ends: no promise handed
    // to the pipeline may stay open for ever.
    const deadline = setTimeout(() => finish(reject, lastError || new Error('the model took too long')), hedgeAfterMs * (attempts - 1) + ATTEMPT_MS + 500);
    if (deadline.unref) deadline.unref();
    const launch = () => {
      if (settled || started >= attempts) return;
      started++;
      clearTimeout(timer);
      if (started < attempts) timer = setTimeout(launch, hedgeAfterMs);
      ask({ timeoutMs: ATTEMPT_MS, ...opts }).then(
        (text) => finish(resolve, text),
        (err) => {
          lastError = err;
          failed++;
          const why = String((err && err.message) || err);
          if (!WORTH_RETRYING.includes(why)) return finish(reject, err);
          if (failed >= attempts) return finish(reject, lastError);
          launch();
          if (failed >= started) finish(reject, lastError);      // nothing left to launch, nothing in flight
        },
      );
    };
    launch();
  });
}

// The whole round trip. Answers one entry per input line, falling back to
// the original text for anything the model did not return, so a line is
// never silently lost.
export async function translateBatch(items, opts = {}) {
  const numbered = items.map((it, n) => ({ ...it, i: n }));
  const text = await askGeminiHedged({ ...opts, request: buildRequest(numbered, opts) }, opts.attempts ? { attempts: opts.attempts } : {});
  const map = translationsFrom(text);
  return numbered.map(({ i, ...it }) => ({
    // Everything the caller handed in is carried through - the channel
    // and colour slot the memory source reads come back untouched, so a
    // translated line still knows whether it was team or all chat. `i` is
    // destructured away rather than set undefined: a key holding
    // undefined is still a key, and callers compare these rows.
    ...it,
    en: map.get(i) || it.text,
    translated: map.has(i),
  }));
}
