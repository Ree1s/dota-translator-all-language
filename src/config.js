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
  source: 'memory',         // 'memory' reads the game; 'log' reads console.log
  // MEASURED on a live match: a poll of the allocations known to hold
  // chat reads ~710 MB in under half a second, and a sweep of the whole
  // 7.5 GB takes 3.8s. At a one-second poll the reader is busy half the
  // time, which is a lot to ask of a machine running a game; at two it is
  // a quarter, and a chat line is on screen for about seven seconds.
  scanIntervalMs: 2000,     // how often to re-read the chat out of memory
  fullRescanMs: 120000,     // how often to sweep the whole process again
  // Most polls read only this many MB either side of where a line has
  // been seen, and every Nth reads the whole of the allocations that hold
  // chat. 0 MB turns windows off. NOT yet sized against a live game: the
  // 4 is a guess, and learn.log's "placement" lines are what replace it.
  scanWindowMb: 4,
  scanWideEvery: 5,
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
