// Where Dota keeps its chat: the handful of numbers a patch can move.
//
// They used to be constants in memscan.ps1, which meant a Dota patch that
// moved one needed a new version of the app in every player's hands, and
// there is no installer and no updater. Now they live in offsets.json at
// the root of the repo, and the app FETCHES that file from master when it
// starts: after a breaking patch the fix is one commit to one file, and
// everybody has it at their next launch.
//
// Order of belief: the file fetched just now; else the last one that was
// fetched (offsets.cache.json, so a fix survives being offline); else the
// copy that shipped with the app. A file that does not pass `parseOffsets`
// whole is not used at all - these numbers say where in another process's
// memory to READ, and a half-right set is worse than the old one. They
// cannot make the app write anywhere: nothing in it writes to the game.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR } from './config.js';

export const OFFSETS_URL = 'https://raw.githubusercontent.com/sc0rebreaker/dota-translator/master/offsets.json';
const BUNDLED = path.join(ROOT, 'offsets.json');
const CACHE = path.join(DATA_DIR, 'offsets.cache.json');

// name -> must it be pointer-aligned? Pointers and the 8-byte position
// pair sit on 8; the 4-byte count, height, width and scale on 4.
const PANEL = {
  uiClient: 8, uiId: 8, uiParent: 8, uiCount: 4, uiKids: 8,
  clientText: 8, textStr: 8,
  uiHeight: 4, uiTextWidth: 4, uiPos: 4, uiScale: 4,
};
const LAYOUT = { chatLeft: [0, 400], chatBottom: [0, 1080], chatHigh: [20, 1080], textLeft: [0, 400] };
const MAX_OFFSET = 0x2000;      // a UI panel is 0x300 long; this is already generous

function toInt(v) {
  if (Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^0x[0-9a-f]{1,4}$/i.test(v.trim())) return parseInt(v.trim(), 16);
  if (typeof v === 'string' && /^[0-9]{1,5}$/.test(v.trim())) return parseInt(v.trim(), 10);
  return NaN;
}

/**
 * The offsets in a parsed offsets.json, as plain numbers - or null if
 * ANYTHING about it is off. All or nothing, on purpose.
 */
export function parseOffsets(raw) {
  if (!raw || typeof raw !== 'object' || !raw.panel || !raw.layout) return null;
  if (!Number.isInteger(raw.version) || raw.version < 1) return null;
  const panel = {}, layout = {};
  for (const [key, align] of Object.entries(PANEL)) {
    const n = toInt(raw.panel[key]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_OFFSET || n % align !== 0) return null;
    panel[key] = n;
  }
  for (const [key, [lo, hi]] of Object.entries(LAYOUT)) {
    const n = raw.layout[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) return null;
    layout[key] = n;
  }
  return { version: raw.version, updated: typeof raw.updated === 'string' ? raw.updated.slice(0, 20) : '', panel, layout };
}

/** What the helper is handed: "uiClient=8;uiId=16;..." - digits and names only. */
export function offsetsArg(panel) {
  return Object.keys(PANEL).map((k) => `${k}=${panel[k]}`).join(';');
}

function readFile(file) {
  try { return parseOffsets(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

export function bundledOffsets() {
  const o = readFile(BUNDLED);
  if (!o) throw new Error('offsets.json is missing or broken');
  return o;
}

/**
 * The offsets to use, and where they came from. Never throws for the
 * network's sake and never waits long for it: a slow GitHub must not be
 * what stands between a player and their match.
 */
export async function loadOffsets({ url = OFFSETS_URL, fetchImpl = globalThis.fetch, timeoutMs = 3000, cacheFile = CACHE } = {}) {
  const shipped = bundledOffsets();
  const newest = (a, b) => (b && b.version >= a.version ? b : a);
  if (url && fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      const fetched = res.ok ? parseOffsets(await res.json()) : null;
      if (fetched) {
        try { fs.writeFileSync(cacheFile, JSON.stringify(fetched)); } catch { /* best effort */ }
        // A fetched file OLDER than the one that shipped is a stale branch
        // or a cache somewhere; the newer of the two is the one to believe.
        const use = newest(shipped, fetched);
        return { ...use, source: use === fetched ? 'fetched' : 'bundled' };
      }
    } catch { /* offline, slow, or not JSON: fall through */ } finally { clearTimeout(timer); }
  }
  const cached = readFile(cacheFile);
  const use = newest(shipped, cached);
  return { ...use, source: use === cached ? 'cached' : 'bundled' };
}
