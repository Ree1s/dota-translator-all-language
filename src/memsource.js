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

export function scannerArgs(script = SCRIPT, { intervalMs = 1000, fullRescanMs = 60000 } = {}) {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-IntervalMs', String(intervalMs),
    '-FullRescanMs', String(fullRescanMs),
  ];
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
    return { kind: 'line', text };
  }
  if (o.t === 'status') return { kind: 'status', state: o.state, detail: o.detail, pid: o.pid };
  if (o.t === 'stat') return { kind: 'stat', ...o, t: undefined };
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

  function handle(ev) {
    if (!ev) return;

    if (ev.kind === 'status') {
      if (ev.pid && ev.pid !== lastPid) {
        // A different game: what we remembered belongs to the old one,
        // and its backlog must be primed past rather than announced.
        tracker.reset();
        priming = true;
        lastPid = ev.pid;
      }
      if (ev.state === 'waiting') {
        tracker.reset();
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
      onStat(ev);
      return;
    }
    if (ev.kind === 'error') { onStatus({ kind: 'error', text: ev.detail }); return; }

    if (ev.kind === 'line') {
      // One scan's findings arrive as separate events, so they are
      // filtered one at a time; the tracker is what makes that safe.
      const { lines, unknownTags } = readMemoryFindings([ev.text]);
      // A channel we have not named would otherwise never be translated
      // and nobody would know why. Said once per tag, not per line.
      for (const tag of unknownTags) {
        if (seenUnknown.has(tag)) continue;
        seenUnknown.add(tag);
        onUnknownTag(tag);
      }
      for (const line of tracker.accept(lines)) {
        if (priming) continue;        // remembered, deliberately not shown
        // The Cyrillic gate, exactly as the log source used it: Dota's
        // own chat-wheel lines are already in the reader's language
        // ("Pushing mid"), and translating those would be noise.
        if (!needsTranslation(line.text, scripts)) continue;
        onMessage({ name: line.name, text: line.text, channel: line.channel });
      }
    }
  }

  function start() {
    if (stopped) return;
    child = spawnImpl(POWERSHELL, scannerArgs(SCRIPT, { intervalMs, fullRescanMs }), {
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
