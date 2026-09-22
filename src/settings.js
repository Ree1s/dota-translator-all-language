// Settings exposed in the setup window.
//
// The old script checkbox API is kept for compatibility with upstream
// configs/tests. The multilingual fork adds a separate target-language list.

import { SUPPORTED_LANGUAGES, SCRIPTS, languageCode } from './languages.js';

export const LANGUAGES = [
  ['cyrillic', 'Russian'],
  ['han', 'Chinese'],
  ['hangul', 'Korean'],
  ['greek', 'Greek'],
  ['arabic', 'Arabic'],
  ['thai', 'Thai'],
];

export const TARGET_LANGUAGES = SUPPORTED_LANGUAGES.map((x) => [x.code, x.label]);

const isEnglish = (s) => ['english', 'en'].includes(String(s || '').trim().toLowerCase());

/** What the legacy settings surface sees: never include the key. */
export function uiSettings(cfg) {
  return {
    scripts: (cfg.scripts || []).filter((s) => s in SCRIPTS),
    showOriginal: cfg.showOriginal !== false,
    showHeroes: cfg.showHeroes !== false,
    fontSize: cfg.fontSize,
    autoUpdate: cfg.autoUpdate !== false,
    sayInto: isEnglish(cfg.replyLanguage) ? 'english' : 'theirs',
  };
}

/** Validate a settings payload before it reaches config.json. */
export function settingsPatch(raw, cfg = {}) {
  const patch = {};
  if (!raw || typeof raw !== 'object') return patch;

  // Upstream-compatible script selection.
  if (Array.isArray(raw.scripts)) {
    const known = LANGUAGES.map(([id]) => id).filter((id) => raw.scripts.includes(id));
    if (known.length) patch.scripts = known;
  }

  // New multilingual target and optional source filter.
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
