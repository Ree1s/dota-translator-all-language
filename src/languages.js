// Language detection and Dota-specific language metadata.
//
// This module is deliberately dependency-free: game chat must be classified
// before a model call is made, and a short Dota line is often code-switched.
// The detector is conservative for Latin text when the display language is
// English (to avoid translating ordinary English), and permissive when the
// user chose another display language (English then needs translating too).

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', label: 'English' },
  { code: 'zh', name: 'Chinese', label: '中文（简体） / Chinese' },
  { code: 'ru', name: 'Russian', label: 'Русский / Russian' },
  { code: 'uk', name: 'Ukrainian', label: 'Українська / Ukrainian' },
  { code: 'ja', name: 'Japanese', label: '日本語 / Japanese' },
  { code: 'ko', name: 'Korean', label: '한국어 / Korean' },
  { code: 'th', name: 'Thai', label: 'ไทย / Thai' },
  { code: 'vi', name: 'Vietnamese', label: 'Tiếng Việt / Vietnamese' },
  { code: 'id', name: 'Indonesian', label: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', label: 'Bahasa Melayu / Malay' },
  { code: 'fil', name: 'Filipino', label: 'Filipino / Tagalog' },
  { code: 'my', name: 'Burmese', label: 'မြန်မာ / Burmese' },
  { code: 'km', name: 'Khmer', label: 'ខ្មែរ / Khmer' },
  { code: 'lo', name: 'Lao', label: 'ລາວ / Lao' },
  { code: 'ar', name: 'Arabic', label: 'العربية / Arabic' },
];

const byCode = new Map(SUPPORTED_LANGUAGES.map((x) => [x.code, x]));
const aliases = new Map();
for (const x of SUPPORTED_LANGUAGES) {
  aliases.set(x.code, x);
  aliases.set(x.name.toLowerCase(), x);
}
for (const [a, code] of Object.entries({
  'simplified chinese': 'zh', 'chinese simplified': 'zh', '中文': 'zh', '简体中文': 'zh',
  'русский': 'ru', 'українська': 'uk',
  'tagalog': 'fil', 'filipino/tagalog': 'fil',
  'bahasa indonesia': 'id', 'bahasa melayu': 'ms',
  'myanmar': 'my', 'burmese/myanmar': 'my',
  'tiếng việt': 'vi', 'vietnam': 'vi',
  'laotian': 'lo', 'cambodian': 'km',
})) aliases.set(a, byCode.get(code));

export function languageInfo(value, fallback = 'en') {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  return aliases.get(raw) || byCode.get(fallback) || byCode.get('en');
}

export const canonicalLanguage = (value, fallback = 'English') =>
  languageInfo(value, languageInfo(fallback).code).name;

export const languageCode = (value, fallback = 'en') => languageInfo(value, fallback).code;

// Kept as a public export because older parts of the project and third-party
// configs refer to these names.
export const SCRIPTS = {
  cyrillic: /[\u0400-\u052F]/,
  greek: /[\u0370-\u03FF]/,
  han: /[\u3400-\u9FFF]/,
  hiragana: /[\u3040-\u309F]/,
  katakana: /[\u30A0-\u30FF]/,
  hangul: /[\uAC00-\uD7AF]/,
  arabic: /[\u0600-\u06FF]/,
  thai: /[\u0E00-\u0E7F]/,
  lao: /[\u0E80-\u0EFF]/,
  myanmar: /[\u1000-\u109F]/,
  khmer: /[\u1780-\u17FF]/,
};

const LETTER = /\p{L}/u;
const CYRILLIC = /[\u0400-\u052F]/;
const UKRAINIAN_MARK = /[іїєґІЇЄҐ]/;
const RUSSIAN_MARK = /[ыэёъЫЭЁЪ]/;
const VI_MARK = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

const wordsOf = (text) => String(text || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{M}']+/gu) || [];
const score = (words, set) => words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);

const RU_LATIN = new Set([
  'privet','davai','davay','nado','net','da','idi','syuda','tuda','pochemu','spasibo',
  'horosho','khorosho','mozhno','nelzya','zhdi','zhdem','rebyata','brat','bratan','suka',
  'blyat','blin','pizda','nahui','nahuy','kuda','kto','gde','zachem','pomogi','pomogite',
]);
const VI_WORDS = new Set([
  'không','ko','đi','đừng','mình','anh','em','được','nào','có','rồi','chưa','đánh','giữa',
  'trên','dưới','rừng','trụ','nhanh','lùi','vào','ra','giúp','farm','combat',
]);
const ID_STRONG = new Set(['ayo','nggak','gak','gue','gua','gw','udah','bang','sini','sana','tolong','cepet','cepat']);
const ID_COMMON = new Set(['jangan','bisa','kita','aku','kamu','sudah','belum','mana','atas','bawah','tengah','hutan','mundur','maju']);
const MS_STRONG = new Set(['jom','tak','kau','awak','korang','dah','undur','cepatlah','sini','sana']);
const MS_COMMON = new Set(['jangan','boleh','kita','aku','saya','belum','mana','tolong','atas','bawah','tengah','hutan']);
const FIL_STRONG = new Set(['tara','huwag','wag','tayo','natin','nyo','niyo','dito','doon','bakit','salamat','bilis','pre']);
const FIL_COMMON = new Set(['ako','ikaw','kayo','atin','kanila','taas','baba','gitna','gubat','tulak','depensa','patay']);

function detected(code, confidence, reason) {
  const info = byCode.get(code) || { code: 'und', name: 'Unknown', label: 'Unknown' };
  return { code: info.code, name: info.name, confidence, reason };
}

export function detectLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw || !LETTER.test(raw)) return detected('und', 0, 'no letters');

  // Distinctive scripts first. Japanese chat may contain Han, so Kana wins.
  if (SCRIPTS.hiragana.test(raw) || SCRIPTS.katakana.test(raw)) return detected('ja', 0.99, 'kana');
  if (SCRIPTS.hangul.test(raw)) return detected('ko', 0.99, 'hangul');
  if (SCRIPTS.thai.test(raw)) return detected('th', 0.99, 'thai');
  if (SCRIPTS.myanmar.test(raw)) return detected('my', 0.99, 'myanmar');
  if (SCRIPTS.khmer.test(raw)) return detected('km', 0.99, 'khmer');
  if (SCRIPTS.lao.test(raw)) return detected('lo', 0.99, 'lao');
  if (SCRIPTS.arabic.test(raw)) return detected('ar', 0.97, 'arabic script');
  if (CYRILLIC.test(raw)) {
    if (UKRAINIAN_MARK.test(raw)) return detected('uk', 0.96, 'ukrainian cyrillic');
    if (RUSSIAN_MARK.test(raw)) return detected('ru', 0.97, 'russian cyrillic');
    return detected('ru', 0.82, 'cyrillic default');
  }
  if (SCRIPTS.han.test(raw)) return detected('zh', 0.96, 'han');

  const words = wordsOf(raw);
  if (!words.length) return detected('und', 0, 'no words');
  if (VI_MARK.test(raw) || score(words, VI_WORDS) >= 2) return detected('vi', VI_MARK.test(raw) ? 0.98 : 0.86, 'vietnamese latin');

  const ru = score(words, RU_LATIN);
  if (ru >= 2 || (ru >= 1 && words.length <= 3)) return detected('ru', ru >= 2 ? 0.88 : 0.72, 'russian transliteration');

  const filStrong = score(words, FIL_STRONG), fil = filStrong * 2 + score(words, FIL_COMMON);
  const idStrong = score(words, ID_STRONG), id = idStrong * 2 + score(words, ID_COMMON);
  const msStrong = score(words, MS_STRONG), ms = msStrong * 2 + score(words, MS_COMMON);
  const best = Math.max(fil, id, ms);
  if (best >= 2) {
    if (fil === best && (filStrong || fil > Math.max(id, ms))) return detected('fil', 0.82, 'filipino latin');
    if (ms === best && (msStrong || ms > id)) return detected('ms', 0.8, 'malay latin');
    return detected('id', 0.8, 'indonesian latin');
  }

  // On Dota's SEA servers English is the lingua franca and many local
  // messages are code-switched. ASCII/Latin text without a stronger signal
  // is therefore best treated as English.
  return detected('en', 0.7, 'latin default');
}

export function shouldTranslate(text, { targetLanguage = 'English', sourceLanguages = ['auto'] } = {}) {
  const raw = String(text || '').trim();
  if (!raw || !LETTER.test(raw)) return false;
  const target = languageCode(targetLanguage);
  const found = detectLanguage(raw);
  if (found.code === 'und' || found.code === target) return false;

  const enabled = Array.isArray(sourceLanguages) ? sourceLanguages : ['auto'];
  if (!enabled.length || enabled.includes('auto')) return true;
  const codes = new Set(enabled.map((x) => languageCode(x, 'und')));
  return codes.has(found.code);
}

export function dotaPromptNotes(targetLanguage) {
  const code = languageCode(targetLanguage);
  if (code === 'zh') return [
    'For Simplified Chinese, sound like concise mainland Chinese Dota chat, not formal prose.',
    'Useful Dota wording: 肉山/打肉 = Roshan, 盾 = Aegis, 买活 = buyback, 开雾 = smoke, 高地 = high ground, 没大 = no ult. Keep BKB, TP, CD, gg, mid/top/bot when Chinese players normally keep them.',
  ].join('\n');
  if (code === 'ru' || code === 'uk') return [
    'For CIS chat, use short natural player wording. Common Dota loanwords and abbreviations such as рош/рошан, бкб, тп, смок, мид, байбек may stay as players type them.',
    'Do not replace map directions with role names: top/mid/bot remain the actual lanes.',
  ].join('\n');
  if (['th','vi','id','ms','fil','my','km','lo'].includes(code)) return [
    'SEA Dota chat is heavily code-switched with English. Preserve common Dota terms such as mid, top, bot, rosh, BKB, TP, smoke, ward, gank, push, def, buyback, ulti/ult when that is natural for players of the target language.',
    'Prefer short match-chat phrasing over textbook or formal language.',
  ].join('\n');
  if (code === 'ja' || code === 'ko') return 'Use concise game-chat wording and preserve standard Dota abbreviations where players normally do.';
  return 'Keep standard Dota shorthand concise and natural for in-game chat.';
}
