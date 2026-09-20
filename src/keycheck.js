// Is this key any good? Asked by the setup window before it saves one:
// a real translation of one short line, so that "saved" means "works".
//
// And when it does not work, WHY, in words a player can act on. The
// model's own messages are written for developers, and the two that
// matter most here are the two this project lost an hour each to.

import { translateBatch } from './translate.js';

export const SAMPLE = 'гг вп';

/** The model's error, or our own, as something to DO. */
export function explainKeyError(message) {
  const m = String(message || '');
  if (/prepayment|credits are depleted|billing/i.test(m)) {
    return 'This key belongs to a Google project with billing switched on and no credit left. Make a new key in a project that has NO billing account - the guide shows where.';
  }
  if (/denied access|PERMISSION_DENIED|403/i.test(m)) {
    return 'Google refused this key\'s project. That happens with some brand-new projects: create the key in a different project and try again.';
  }
  if (/API key not valid|API_KEY_INVALID|invalid api key|400/i.test(m)) {
    return 'Google does not recognise this key. Copy it again with the Copy button in AI Studio - a missing character is the usual reason.';
  }
  if (/quota|rate limit|429|RESOURCE_EXHAUSTED/i.test(m)) {
    return 'The key is real, but it has used up its requests for the moment. Wait a minute and press the button again.';
  }
  if (/could not reach|took too long|never answered|network|fetch failed/i.test(m)) {
    return 'Could not reach Google. Check the internet connection and try again.';
  }
  return 'Google answered: ' + (m || 'nothing at all') + '.';
}

/** What a pasted key should look like before anybody is asked about it. */
export function tidyKey(raw) {
  // People copy keys with the quotes, a trailing space, or a line break.
  return String(raw || '').trim().replace(/^["']+|["',]+$/g, '').trim();
}

export function looksLikeKey(key) {
  return /^[A-Za-z0-9_\-.]{20,200}$/.test(key);
}

/**
 * Try the key for real. Resolves { ok, sample, en } or { ok: false, why }.
 * Never throws: the caller is a button.
 */
export async function checkKey(key, { model, translate = translateBatch } = {}) {
  const tidy = tidyKey(key);
  if (!tidy) return { ok: false, why: 'Paste your key first.' };
  if (!looksLikeKey(tidy)) return { ok: false, why: 'That does not look like a key. It is one long run of letters and numbers with no spaces in it.' };
  try {
    const [row] = await translate([{ name: 'test', text: SAMPLE }], { apiKey: tidy, model });
    if (!row || !row.translated) return { ok: false, why: 'Google answered, but not with a translation. Try once more.' };
    return { ok: true, key: tidy, sample: SAMPLE, en: row.en };
  } catch (err) {
    return { ok: false, why: explainKeyError(err && err.message) };
  }
}
