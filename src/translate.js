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
  'You translate Dota 2 in-game chat into English.',
  'The input is a JSON array of {i, name, text}. Answer with a JSON array of {i, en}, one entry per input, same i values.',
  'Rules:',
  '- Translate only the text. Never translate or change a player name.',
  '- Keep it short and plain, the way the line would be typed in English.',
  '- Dota shorthand stays shorthand: mid, top, bot, gank, ward, roshan, bkb, tp, gg, ff, ss/miss, rune, stack, push, def, rosh, smoke, buyback, courier.',
  '- Translate insults and swearing as they are. Do not soften, censor or explain them.',
  '- Transliterated Russian typed in Latin letters is still Russian: translate it.',
  '- If a line is already English, or is only emotes, numbers or punctuation, return it unchanged.',
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
  let res;
  try {
    res = await fetchImpl(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err && err.name === 'AbortError' ? 'the model took too long' : 'could not reach the model');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
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

// How long the FIRST try is given. MEASURED, six single-line calls to
// gemini-3.5-flash-lite: five answered in 0.7-1.0s and one never answered
// at all. A call is therefore either quick or lost, and waiting 12s to
// find out which put a line on the overlay 14 seconds after it was said -
// in a fight, that is never. Given 2.5s, a lost call costs 2.5s plus one
// ordinary call. The second try gets longer, because by then a slow
// answer is better than none.
export const FIRST_TRY_MS = 2500;
export const SECOND_TRY_MS = 8000;

export async function askGeminiTwice(opts) {
  try {
    return await askGemini({ timeoutMs: FIRST_TRY_MS, ...opts });
  } catch (err) {
    const why = String((err && err.message) || err);
    if (!WORTH_RETRYING.includes(why)) throw err;
    return askGemini({ ...opts, timeoutMs: Math.max(SECOND_TRY_MS, opts.timeoutMs || 0) });
  }
}

// The whole round trip. Answers one entry per input line, falling back to
// the original text for anything the model did not return, so a line is
// never silently lost.
export async function translateBatch(items, opts = {}) {
  const numbered = items.map((it, n) => ({ ...it, i: n }));
  const text = await askGeminiTwice({ ...opts, request: buildRequest(numbered, opts) });
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
