// The memory source: runs memscan.ps1 and turns what it finds into the
// same {name, text} messages the log source used to produce.
//
// The helper is spawned ONCE and kept alive, so nothing pays PowerShell's
// startup or its C# compile per poll. It is read-only - see the notes at
// the top of memscan.ps1.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMemoryFindings, createLineTracker } from './chatmem.js';
import { needsTranslation } from './chatlog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCRIPT = path.join(HERE, 'memscan.ps1');

// Windows PowerShell, which every Windows has - not `pwsh`, which is an
// optional install. The script uses nothing newer than 5.1.
export const POWERSHELL = 'powershell.exe';

export function scannerArgs(script = SCRIPT, {
  intervalMs = 1000,
  fullRescanMs = 60000,
  parentPid = process.pid,
  windowMb,
  wideEvery,
  wideCapMb,
  panel,
  panelIntervalMs,
  offsets,
  processName,
} = {}) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-IntervalMs', String(intervalMs),
    '-FullRescanMs', String(fullRescanMs),
    // So the helper stops when we do, however we stop. child.kill() only
    // happens on a clean quit; a force-killed Electron left the scanner
    // reading the game's memory with nobody listening.
    '-ParentPid', String(parentPid),
  ];
  // Left to the script's own defaults unless somebody has an opinion.
  if (Number.isFinite(windowMb)) args.push('-WindowMb', String(windowMb));
  if (Number.isFinite(wideEvery)) args.push('-WideEvery', String(wideEvery));
  if (Number.isFinite(wideCapMb)) args.push('-WideCapMb', String(wideCapMb));
  if (panel === false) args.push('-Panel', '0');
  if (Number.isFinite(panelIntervalMs)) args.push('-PanelIntervalMs', String(panelIntervalMs));
  // Only ever digits and known names: it is a command line.
  if (typeof offsets === 'string' && /^[A-Za-z]+=[0-9]+(;[A-Za-z]+=[0-9]+)*$/.test(offsets)) args.push('-Offsets', offsets);
  if (processName) args.push('-ProcessName', processName);
  return args;
}

/**
 * How far a newly found line was from the nearest place a line had been
 * seen before. This is the number that sizes the scan window, and the
 * one thing about windows that only a live game can say.
 */
export function nearestDistance(addr, known) {
  if (!Number.isFinite(addr) || !known || known.length === 0) return null;
  let best = Infinity;
  for (const k of known) best = Math.min(best, Math.abs(addr - k));
  return best;
}

/**
 * Decode one line of the helper's output.
 * Returns the parsed event, or null for anything unreadable - a partial
 * line while the pipe is filling is ordinary, not an error.
 */
export function parseEvent(raw) {
  const s = String(raw || '').trim();
  if (!s || s[0] !== '{') return null;
  let o;
  try { o = JSON.parse(s); } catch { return null; }
  if (!o || typeof o !== 'object') return null;

  if (o.t === 'line') {
    if (typeof o.b64 !== 'string') return null;
    // base64, because a Cyrillic line written straight to stdout arrives
    // as mojibake on any machine whose console is not UTF-8.
    let text;
    try { text = Buffer.from(o.b64, 'base64').toString('utf8'); } catch { return null; }
    // Where it was found, when the helper says. A user-space address is
    // under 2^47, so a JS number holds it exactly.
    if (typeof o.a === 'number') {
      return { kind: 'line', text, fresh: o.n === 1, ...(typeof o.h === 'string' && /^[a-z_]{2,40}$/.test(o.h) ? { hero: o.h } : {}), addr: o.a, inWindow: o.w === 1, region: o.r, regionSize: o.rs, alloc: o.ab, isPrivate: o.p === 1 };
    }
    return { kind: 'line', text };
  }
  if (o.t === 'status') return { kind: 'status', state: o.state, detail: o.detail, pid: o.pid, ...(typeof o.path === 'string' && o.path ? { path: o.path } : {}) };
  if (o.t === 'stat') return { kind: 'stat', ...o, t: undefined };
  // A search for the chat panel: what it cost and whether it found one.
  // NOT a stat - a stat says a read is over, which ends priming.
  if (o.t === 'find') return { kind: 'find', panels: o.panels, ms: o.ms, mb: o.mb };
  // Where the game draws its chat, and the stack of rows in it, newest
  // first: what laying the English OVER a line needs to know.
  if (o.t === 'layout') {
    if (!Array.isArray(o.rows) || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
    return { kind: 'layout', x: o.x, y: o.y, scale: Number.isFinite(o.s) && o.s > 0 ? o.s : 1, rows: o.rows.map((r) => ({ addr: r.a, height: r.h, width: r.w })) };
  }
  if (o.t === 'focus') return { kind: 'focus', on: o.on === 1 };
  if (o.t === 'error') return { kind: 'error', detail: o.detail };
  return null;
}

/**
 * Start reading chat out of Dota's memory.
 *
 * onMessage({name, text})  a line worth translating
 * onStatus({kind, text})   same shape the log watcher reports
 * onStat(stat)             scan timings, for the doctor
 */
export function startMemorySource({
  scripts = ['cyrillic'],
  intervalMs = 1000,
  fullRescanMs = 60000,
  spawnImpl = spawn,
  onMessage = () => {},
  onStatus = () => {},
  onStat = () => {},
  onUnknownTag = () => {},
  onPlacement = () => {},
  onFind = () => {},
  onLayout = () => {},
  onSeen = () => {},
  onFocus = () => {},
  onGamePath = () => {},
  offsets,
  panel,
  panelIntervalMs,
  windowMb,
  wideEvery,
  wideCapMb,
  processName,
} = {}) {
  const tracker = createLineTracker();
  const seenUnknown = new Set();
  // The first sweep of a game finds everything already said, and showing
  // it would dump the whole match backlog onto the overlay at the moment
  // you start the app. So the first sweep only PRIMES the tracker and
  // says nothing - the same rule LogTail follows by starting at the end
  // of the log rather than the beginning.
  let priming = true;
  let child = null;
  let stopped = false;
  let buffer = '';
  let lastPid = 0;
  // Addresses lines have been seen at, mirroring what the helper builds
  // its windows from: this scan's are held back until its stat arrives,
  // so a new line is measured against where chat WAS, not against the
  // second copy of itself found in the same scan.
  let known = [];
  let pendingAddrs = [];
  let pendingPlacements = [];

  function forgetPlaces() { known = []; pendingAddrs = []; pendingPlacements = []; }

  function handle(ev) {
    if (!ev) return;

    if (ev.kind === 'status') {
      if (ev.path) onGamePath(ev.path);
      if (ev.pid && ev.pid !== lastPid) {
        // A different game: what we remembered belongs to the old one,
        // and its backlog must be primed past rather than announced.
        tracker.reset();
        forgetPlaces();
        priming = true;
        lastPid = ev.pid;
      }
      if (ev.state === 'waiting') {
        tracker.reset();
        forgetPlaces();
        priming = true;
        lastPid = 0;
        onStatus({ kind: 'waiting', text: 'Waiting for Dota 2.' });
      } else if (ev.state === 'scanning') {
        onStatus({ kind: 'scanning', text: 'Finding the chat in memory...' });
      } else if (ev.state === 'reading') {
        onStatus({ kind: 'ready', text: 'Reading chat.' });
      }
      return;
    }

    if (ev.kind === 'stat') {
      // The sweep is over, so everything it found is now remembered and
      // whatever turns up next is genuinely new.
      priming = false;
      for (const p of pendingPlacements) onPlacement({ ...p, mode: ev.mode || (ev.full ? 'full' : 'wide') });
      known = ev.full ? pendingAddrs : known.concat(pendingAddrs);
      pendingAddrs = [];
      pendingPlacements = [];
      onStat(ev);
      return;
    }
    if (ev.kind === 'find') { onFind(ev); return; }
    if (ev.kind === 'layout') { onLayout(ev); return; }
    if (ev.kind === 'focus') { onFocus(ev.on); return; }
    if (ev.kind === 'error') { onStatus({ kind: 'error', text: ev.detail }); return; }

    if (ev.kind === 'line') {
      // One scan's findings arrive as separate events, so they are
      // filtered one at a time; the tracker is what makes that safe.
      if (Number.isFinite(ev.addr)) pendingAddrs.push(ev.addr);
      const { lines, unknownTags } = readMemoryFindings([ev.text]);
      // A channel we have not named would otherwise never be translated
      // and nobody would know why. Said once per tag, not per line.
      for (const tag of unknownTags) {
        if (seenUnknown.has(tag)) continue;
        seenUnknown.add(tag);
        onUnknownTag(tag);
      }
      // Every sighting, repeats included: the game makes all its chat lines
      // again when it trims them, at NEW addresses, and the tracker rightly
      // drops those as already shown - but whoever is drawing over a line
      // needs to know where it lives now.
      if (Number.isFinite(ev.addr)) for (const line of lines) onSeen({ addr: ev.addr, channel: line.channel, name: line.name, text: line.text });
      // A line the chat list says was just appended is new whatever its
      // words: the tracker is still told, but is not asked.
      const accepted = tracker.accept(lines);
      for (const line of (ev.fresh ? lines : accepted)) {
        if (priming) continue;        // remembered, deliberately not shown
        // Every NEW line counts here, English ones too: where the game
        // puts a line does not depend on what language it is in.
        if (Number.isFinite(ev.addr)) {
          pendingPlacements.push({
            inWindow: ev.inWindow, distance: nearestDistance(ev.addr, known), channel: line.channel, text: line.text,
            ...(Number.isFinite(ev.region)
              ? { addr: ev.addr, region: ev.region, regionSize: ev.regionSize, alloc: ev.alloc } : {}),
          });
        }
        // The Cyrillic gate, exactly as the log source used it: Dota's
        // own chat-wheel lines are already in the reader's language
        // ("Pushing mid"), and translating those would be noise.
        if (!needsTranslation(line.text, scripts)) continue;
        onMessage({ name: line.name, text: line.text, channel: line.channel, slot: line.slot, ...(ev.hero ? { hero: ev.hero } : {}) });
      }
    }
  }

  function start() {
    if (stopped) return;
    child = spawnImpl(POWERSHELL, scannerArgs(SCRIPT, { intervalMs, fullRescanMs, windowMb, wideEvery, wideCapMb, panel, panelIntervalMs, offsets, processName }), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop();           // keep the half-written last line
      for (const p of parts) handle(parseEvent(p));
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => {
      const text = String(d).trim();
      if (text) onStatus({ kind: 'error', text });
    });

    child.on('error', (err) => {
      onStatus({ kind: 'error', text: 'Could not run PowerShell: ' + err.message });
    });

    child.on('exit', () => {
      child = null;
      if (stopped) return;
      // The helper loops forever, so an exit means it died. Come back
      // rather than going quiet - the overlay would otherwise sit there
      // looking fine and never say another word.
      onStatus({ kind: 'error', text: 'Reader stopped; restarting.' });
      setTimeout(start, 2000).unref?.();
    });
  }

  start();

  return {
    stop() {
      stopped = true;
      if (child) { try { child.kill(); } catch { /* already gone */ } }
      child = null;
    },
    get running() { return Boolean(child); },
  };
}
