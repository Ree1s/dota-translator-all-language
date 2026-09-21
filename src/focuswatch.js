// Keeps focuswatch.ps1 running and passes on what it says: whether Dota is
// the window in front. Only the GSI source needs it - the memory helper
// reports focus itself.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POWERSHELL } from './memsource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FOCUS_SCRIPT = path.join(HERE, 'focuswatch.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

export function startFocusWatch({ onFocus = () => {}, spawnImpl = spawn, parentPid = process.pid, processName, restartMs = 2000 } = {}) {
  let child = null;
  let stopped = false;
  let buffer = '';

  function start() {
    if (stopped) return;
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', FOCUS_SCRIPT, '-ParentPid', String(parentPid)];
    if (processName && /^[A-Za-z0-9_.-]{1,64}$/.test(processName)) args.push('-ProcessName', processName);
    child = spawnImpl(POWERSHELL, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop();
      for (const p of parts) {
        let o = null;
        try { o = JSON.parse(p); } catch { continue; }
        if (o && o.t === 'focus') onFocus(o.on === 1);
      }
    });
    child.on('error', () => { /* no PowerShell: the overlay simply stays up */ });
    child.on('exit', () => {
      child = null;
      if (!stopped) setTimeout(start, restartMs).unref?.();
    });
  }

  start();
  return {
    stop() {
      stopped = true;
      if (child) { try { child.kill(); } catch { /* already gone */ } }
      child = null;
    },
  };
}
