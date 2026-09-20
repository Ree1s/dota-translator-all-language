// Settings live in config.json beside the app. Missing file, missing
// keys and a file that will not parse all fall back to the defaults, so
// a first run works with nothing but a key pasted in.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'config.json');

export const DEFAULTS = {
  geminiApiKey: '',
  model: 'gemini-3.5-flash-lite',
  logPath: '',              // blank = find the Steam install
  scripts: ['cyrillic'],    // which writing systems to translate
  batchMs: 400,             // how long to gather lines before one call
  holdSeconds: 14,          // how long a line stays on the overlay
  maxLines: 6,
  showOriginal: true,
  fontSize: 16,
  opacity: 0.92,
  position: 'top-left',     // top-left, top-right, bottom-left, bottom-right
  clickThrough: true,
  learn: false,             // log unmatched lines to learn.log
};

export function mergeConfig(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const want = typeof DEFAULTS[key];
    if (Array.isArray(DEFAULTS[key])) {
      if (Array.isArray(raw[key])) out[key] = raw[key].slice();
      continue;
    }
    if (typeof raw[key] === want) out[key] = raw[key];
  }
  // An env var wins, so a key need never be written to disk.
  if (process.env.GEMINI_API_KEY) out.geminiApiKey = process.env.GEMINI_API_KEY;
  return out;
}

export function loadConfig(file = CONFIG_PATH) {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* defaults */ }
  return mergeConfig(raw);
}
