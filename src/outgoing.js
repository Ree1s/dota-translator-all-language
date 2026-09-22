// The other direction: what the PLAYER wants to say, in the language the
// people they are playing with have been typing in.
//
// Asked for by the first people who saw the app ("no point in receiving
// messages in English if he doesn't understand me"). Nothing is sent to
// the game and nothing is typed into it: the translation goes on the
// CLIPBOARD and the player pastes it into the game's chat themselves. The
// app reads the game and never touches it; this does not change that.
//
// Which language is not a guess. The app reads every line the others
// type, so it knows what they write in: the script seen most recently
// decides, and Russian - what this is for - until anything has been seen.

import { askGeminiHedged } from './translate.js';
import { canonicalLanguage, detectLanguage, dotaPromptNotes, languageCode } from './languages.js';

// Legacy exports kept for callers that imported these names. Language
// tracking itself now uses the multilingual detector instead of equating a
// Unicode script with one language.
export const SCRIPT_LANGUAGE = {
  cyrillic: 'Russian', han: 'Chinese', hangul: 'Korean', greek: 'Greek',
  arabic: 'Arabic', thai: 'Thai', lao: 'Lao', myanmar: 'Burmese', khmer: 'Khmer',
};

export const MAX_SAY = 200;          // a chat line, not a letter
export const HOTKEY_DIGITS = ['1','2','3'];

export function languageFromHotkey(key, languages = []) {
  const m = /^Control\+Enter\+([0-9])$/.exec(String(key || ''));
  if (!m) return '';
  const at = HOTKEY_DIGITS.indexOf(m[1]);
  if (at < 0 || at >= languages.length) return '';
  if (languageCode(languages[at], 'und') === 'und') return '';
  return canonicalLanguage(languages[at]);
}

export function scriptOf(text) {
  const code = detectLanguage(text).code;
  return ({ ru: 'cyrillic', uk: 'cyrillic', zh: 'han', ja: 'han', ko: 'hangul', th: 'thai', ar: 'arabic', lo: 'lao', my: 'myanmar', km: 'khmer' })[code] || '';
}

/** Remembers the most recent confidently detected language teammates used. */
export function createLanguageTracker({ fallback = 'Russian' } = {}) {
  let last = '';
  return {
    saw(text) {
      const d = detectLanguage(text);
      if (d.code !== 'und' && d.confidence >= 0.72) last = d.name;
    },
    get language() { return last || fallback; },
  };
}

/** `replyLanguage` from config: "auto", or a language by name. */
export function targetLanguage(setting, tracker) {
  const s = String(setting || 'auto').trim();
  if (!s || s.toLowerCase() === 'auto') return tracker ? tracker.language : 'Russian';
  const clean = s.replace(/[^\p{L} ]/gu, '').slice(0, 24).trim();
  if (!clean) return 'Russian';
  return languageCode(clean, 'und') === 'und' ? clean : canonicalLanguage(clean, 'Russian');
}

export function tidySay(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_SAY);
}

export function outSystem(language, style = 'faithful') {
  const target = canonicalLanguage(language, 'Russian');
  const savage = style === 'savage';
  const toneRules = savage ? [
    '- SAVAGE MODE: keep the core meaning/gameplay point, but rewrite it as extremely aggressive, vulgar, mocking Dota trash talk in the target language.',
    '- Use strong, idiomatic local profanity, sexual insults, personal attacks, and common regional/national insults that real players of that language actually type. Prefer short, punchy, culturally natural abuse over literal wording.',
    '- Sexual-level vulgarity is allowed and encouraged when it fits (mother insults, anal insults, family insults, etc.). Make it as dirty and aggressive as typical toxic game chat in that language.',
    '- You may intensify ordinary insults and sexual profanity for maximum punch. Do not sanitize, soften, euphemize, or add politeness.',
    '- Nationality, country, and regional mockery is allowed if it is the kind of trash talk players of that language commonly use.',
    '- Do NOT use threats of real-world physical violence, encouragement of self-harm, detailed sexual-violence or rape descriptions, doxxing, or private personal information.',
    '- Do not invent factual accusations about a real person. Keep it as game trash talk.',
  ] : [
    '- Keep the tone and intent faithful. Friendly stays friendly; blunt stays blunt; hostile stays hostile.',
    '- If the source contains insults, profanity, trash talk or contempt, translate them into natural target-language game-chat wording of comparable force. Prefer an idiomatic local insult/profanity over an awkward literal translation.',
    '- Do not censor, sanitize, euphemize, or add politeness. Also do not make the abuse stronger than the source, invent new personal attacks, or introduce slurs/protected-class references that were not present.',
  ];
  return [
    `You translate what a Dota 2 player wants to type in the in-game chat, from whatever language they wrote it in (usually Chinese, English or Russian, sometimes code-switched), into ${target}.`,
    'The input is JSON: {"text": "..."}. Answer with JSON: {"out": "..."}.',
    'Rules:',
    `- Write it the way a ${target}-speaking Dota player would actually type it in a match: short, informal, no formal register.`,
    '- Everyday neutral words stay plain and common. Do not force slang into normal friendly lines.',
    `- Game terms are different: use the Dota slang that players of that language really use. Hero, item and ability names as those players write them; leave a name in Latin letters when they would.`,
    '- top, mid and bot are places on the map: say exactly that lane. Never turn one into "safe lane", "off lane" or "hard lane".',
    ...toneRules,
    '- Numbers, timings and item counts stay exactly as typed.',
    '- One line, no line breaks, no quotation marks, no notes, no transliteration, no explanation.',
    ...(savage
      ? [`- If the text is already in ${target}, still rewrite it in SAVAGE MODE rather than returning it unchanged.`]
      : [`- If the text is already in ${target}, return it unchanged.`]),
    dotaPromptNotes(target),
  ].join('\n');
}

export function buildOutRequest(text, language, style = 'faithful') {
  const savage = style === 'savage';
  return {
    systemInstruction: { parts: [{ text: outSystem(language, style) }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ text: tidySay(text) }) }] }],
    generationConfig: {
      temperature: savage ? 0.45 : 0,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { out: { type: 'STRING' } }, required: ['out'] },
    },
  };
}

/** The line to paste, or '' when the reply is not one. */
export function outFrom(replyText) {
  let parsed = null;
  try { parsed = JSON.parse(String(replyText || '')); } catch { return ''; }
  const out = parsed && typeof parsed.out === 'string' ? parsed.out : '';
  // It is going to be pasted into a one-line chat field.
  return out.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * One translator for the app's lifetime: it keeps what it has already
 * translated ("go rosh", "buy wards" - a player says the same twenty
 * things), so a repeat costs no call and no second.
 *
 * And it keeps them ON DISK (`store`), because that is the only thing that
 * makes the same English come out as the same line tomorrow (the user
 * asked whether it always would). MEASURED at temperature 0, three fresh
 * calls each: "nice play" -> "хорошая игра" | "хорошо сыграно" | "найс
 * плей"; "play safe" three ways too. All fine, none the same: the model
 * cannot be made to repeat itself, so the first answer is remembered. It
 * is a plain JSON file the player can read and correct.
 */
// What comes back from anywhere is made one chat line before it is pasted.
const tidyOut = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 400);

export function createOutgoing({ apiKey, model, ask = askGeminiHedged, cacheSize = 500, store = null, remote = null } = {}) {
  const cache = new Map();
  if (store) {
    try {
      const was = store.read();
      if (was && typeof was === 'object' && !Array.isArray(was)) {
        for (const [k, v] of Object.entries(was)) if (typeof v === 'string' && v.trim()) cache.set(k, v.replace(/\s+/g, ' ').trim().slice(0, 400));
      }
    } catch { /* no file yet, or not JSON: start afresh */ }
  }
  const keep = () => { if (store) { try { store.write(Object.fromEntries(cache)); } catch { /* a read-only disk costs the memory, not the line */ } } };
  return async function say(text, language, style = 'faithful') {
    const clean = tidySay(text);
    const mode = style === 'savage' ? 'savage' : 'faithful';
    if (!clean) throw new Error('nothing to translate');
    const key = language + '|' + mode + '|' + clean.toLowerCase();
    const legacyKey = language + '|' + clean.toLowerCase();
    if (cache.has(key)) return { out: cache.get(key), language, cached: true };
    // Existing said.json files used "Language|text" before tone modes existed.
    // Keep those hand-corrected faithful translations authoritative.
    if (mode === 'faithful' && cache.has(legacyKey)) {
      const out = cache.get(legacyKey);
      cache.set(key, out);
      return { out, language, cached: true };
    }
    // Two tries, not three: the incoming chat lives on the same 15 calls a minute.
    // `remote()` answers a function when the hosted translator is in use (no
    // key of the player's own): it is sent the line, never a prompt.
    // The hosted service only knows the normal faithful prompt. Savage mode
    // must use the player's own Gemini key so the style instruction is honored.
    const hosted = mode === 'faithful' && remote ? remote() : null;
    const out = hosted
      ? tidyOut(await hosted(clean, language))
      : outFrom(await ask({ apiKey: typeof apiKey === 'function' ? apiKey() : apiKey, model, request: buildOutRequest(clean, language, mode) }, { attempts: 2 }));
    if (!out) throw new Error('the model gave no translation');
    cache.set(key, out);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);
    keep();
    return { out, language, cached: false };
  };
}