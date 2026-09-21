// Keeps rowgrab.ps1 running and asks it one thing: whose portrait stands
// beside the newest row of the game's own chat. Only the GSI source needs
// it - the feed gives a speaker's seat, never their hero.
//
// It is SCREEN CAPTURE: one small rectangle of the player's own game, only
// while the game is in front, compared on this PC with the game's own
// portraits and thrown away. Nothing is saved or sent anywhere.
//
// The portraits to compare with come from the player's install
// (heroface.js: disk, never the process) and are written to a temp folder
// for the helper - never into the repo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POWERSHELL } from './memsource.js';
import { faces, readIndex } from './heroface.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROW_SCRIPT = path.join(HERE, 'rowgrab.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

// MEASURED over a whole match and a replay: the right hero 0.89-0.93 beside
// a chat row, the best wrong one 0.51-0.66, a grab of anything else < 0.73.
export const SURE = 0.8;

/** The game's portraits as files, once per install. Returns the folder or null. */
export function writeRefs(dotaDir, dir = path.join(os.tmpdir(), 'dota-translator-faces')) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.readdirSync(dir).length >= 100) return dir;
    const face = faces(dotaDir);
    let n = 0;
    for (const hero of readIndex(path.join(dotaDir, 'pak01_dir.vpk')).keys()) {
      const m = /^data:image\/(png|bmp);base64,(.*)$/.exec(face(hero) || '');
      if (m) { fs.writeFileSync(path.join(dir, hero + '.' + m[1]), Buffer.from(m[2], 'base64')); n++; }
    }
    return n ? dir : null;
  } catch { return null; }
}

/**
 * startRowGrab({dotaDir}) -> { identify(): Promise<{hero, score}|null>, stop() }
 * identify never rejects and never takes longer than `timeoutMs`: a line is
 * waiting on it.
 */
export function startRowGrab({ dotaDir, refs, spawnImpl = spawn, parentPid = process.pid, timeoutMs = 700, restartMs = 5000, sure = SURE } = {}) {
  const folder = refs || (dotaDir ? writeRefs(dotaDir) : null);
  if (!folder) return { identify: async () => null, stop() {} };

  let child = null, ready = false, stopped = false, buffer = '', nextId = 1;
  const waiting = new Map();
  const settle = (id, value) => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id); clearTimeout(w.timer); w.resolve(value);
  };

  function start() {
    if (stopped) return;
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ROW_SCRIPT, '-ParentPid', String(parentPid), '-Refs', folder];
    child = spawnImpl(POWERSHELL, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop();
      for (const p of parts) {
        let o = null;
        try { o = JSON.parse(p); } catch { continue; }
        if (o && o.t === 'ready') ready = o.refs > 0;
        else if (o && o.t === 'row') {
          const good = o.ok === 1 && typeof o.hero === 'string' && /^[a-z_]+$/.test(o.hero) && o.score >= sure;
          settle(o.id, good ? { hero: o.hero, score: o.score } : null);
        }
      }
    });
    child.stdin.on('error', () => { /* the helper went away mid-write */ });
    child.on('error', () => { /* no PowerShell: speakers stay unnamed */ });
    child.on('exit', () => {
      child = null; ready = false;
      for (const id of [...waiting.keys()]) settle(id, null);
      if (!stopped) setTimeout(start, restartMs).unref?.();
    });
  }

  start();
  return {
    identify() {
      if (!child || !ready) return Promise.resolve(null);
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(id, null), timeoutMs);
        waiting.set(id, { resolve, timer });
        try { child.stdin.write('row ' + id + '\n'); } catch { settle(id, null); }
      });
    },
    stop() {
      stopped = true;
      for (const id of [...waiting.keys()]) settle(id, null);
      if (child) { try { child.kill(); } catch { /* already gone */ } }
      child = null;
    },
  };
}
