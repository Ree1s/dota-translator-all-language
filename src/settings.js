// Settings exposed in the setup window.

import { SUPPORTED_LANGUAGES, canonicalLanguage, languageCode } from './languages.js';

export const LANGUAGES = SUPPORTED_LANGUAGES.map((x) => [x.code, x.label]);

const isEnglish = (s) => languageCode(s) === 'en';

/** What the window is shown: only these, never the key. */
export function uiSettings(cfg) {
  return {
    targetLanguage: languageCode(cfg.targetLanguage || 'English'),
    sourceLanguages: Array.isArray(cfg.sourceLanguages) && cfg.sourceLanguages.length ? cfg.sourceLanguages.slice() : ['auto'],
    showOriginal: cfg.showOriginal !== false,
    showHeroes: cfg.showHeroes !== false,
    fontSize: cfg.fontSize,
    autoUpdate: cfg.autoUpdate !== false,
    // Keep the old two-way send control. "theirs" now means the latest
    // teammate language detected by languages.js, not "Russian".
    sayInto: isEnglish(cfg.replyLanguage) ? 'english' : 'theirs',
  };
}

/** Validate a settings payload before it reaches config.json. */
export function settingsPatch(raw, cfg = {}) {
  const patch = {};
  if (!raw || typeof raw !== 'object') return patch;

  if (typeof raw.targetLanguage === 'string') {
    const code = languageCode(raw.targetLanguage, 'und');
    const known = SUPPORTED_LANGUAGES.find((x) => x.code === code);
    if (known) patch.targetLanguage = known.name;
  }

  if (Array.isArray(raw.sourceLanguages)) {
    if (raw.sourceLanguages.includes('auto')) patch.sourceLanguages = ['auto'];
    else {
      const knownCodes = new Set(SUPPORTED_LANGUAGES.map((x) => x.code));
      const selected = [...new Set(raw.sourceLanguages.map((x) => languageCode(x, 'und')).filter((x) => knownCodes.has(x)))];
      if (selected.length) patch.sourceLanguages = selected;
    }
  }

  for (const key of ['showOriginal', 'showHeroes', 'autoUpdate']) {
    if (typeof raw[key] === 'boolean') patch[key] = raw[key];
  }

  if (raw.sayInto === 'english') patch.replyLanguage = 'English';
  else if (raw.sayInto === 'theirs' && isEnglish(cfg.replyLanguage)) patch.replyLanguage = 'auto';

  const size = Number(raw.fontSize);
  if (Number.isFinite(size)) patch.fontSize = Math.min(28, Math.max(11, Math.round(size)));
  return patch;
}
