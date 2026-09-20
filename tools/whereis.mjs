// A one-off diagnostic: WHERE in the game's memory is a chat line, at the
// moment it is said?
//
//   node tools/whereis.mjs            against dota2, for 90 seconds
//   node tools/whereis.mjs fakedota   against the stand-in
//
// It runs nothing but FULL sweeps, back to back, and writes every copy
// of every Cyrillic line it finds to whereis.log with its address,
// region, region size and allocation - and whether an ordinary POLL
// could have seen that copy at all (private memory, region under the
// 64 MB poll cap). A full sweep has no heuristics in it, so a line it
// finds that the polls did not is a line the heuristics lost.
//
// THIS IS HEAVY: the whole process, read continuously, for as long as it
// runs. It is for a bot match and a minute and a half, never for play.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scannerArgs, parseEvent, SCRIPT, POWERSHELL } from '../src/memsource.js';
import { readMemoryFindings } from '../src/chatmem.js';
import { needsTranslation } from '../src/chatlog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'whereis.log');
const processName = process.argv[2] || 'dota2';
const RUN_MS = Number(process.argv[3] || 90000);
const POLL_CAP = 64 * 1024 * 1024;

const hex = (n) => '0x' + Number(n).toString(16);
const time = () => new Date().toTimeString().slice(0, 8);
const log = (row) => { fs.appendFileSync(OUT, row + '\n'); };

const child = spawn(POWERSHELL, [
  ...scannerArgs(SCRIPT, { intervalMs: 250, fullRescanMs: 0, processName }),
  '-SweepThreads', '2',
], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

const firstSeen = new Map();     // text -> sweep number it first appeared in
let sweep = 0;
let copies = [];                 // this sweep's Cyrillic copies
let buffer = '';

log(`# whereis ${new Date().toISOString()} against ${processName}`);

function endSweep(stat) {
  sweep++;
  const fresh = [];
  for (const c of copies) if (!firstSeen.has(c.text)) { firstSeen.set(c.text, sweep); fresh.push(c.text); }
  const byText = new Map();
  for (const c of copies) { if (!byText.has(c.text)) byText.set(c.text, []); byText.get(c.text).push(c); }
  console.log(`[${time()}] sweep ${sweep}: ${stat.ms}ms ${stat.mb}MB, ${byText.size} lines, ${copies.length} copies` +
    (fresh.length && sweep > 1 ? `  NEW: ${[...new Set(fresh)].join(' | ')}` : ''));
  for (const [text, list] of byText) {
    for (const c of list) {
      log(`sweep=${sweep} t=${time()} new=${firstSeen.get(text) === sweep && sweep > 1 ? 1 : 0} pollable=${c.pollable ? 1 : 0} ` +
        `form=${c.form} channel=${c.channel} addr=${hex(c.addr)} region=${hex(c.region)} regionMb=${(c.regionSize / 1048576).toFixed(1)} ` +
        `alloc=${hex(c.alloc)} private=${c.isPrivate ? 1 : 0} text=${JSON.stringify(text)}`);
    }
  }
  copies = [];
}

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  const parts = buffer.split(/\r?\n/);
  buffer = parts.pop();
  for (const p of parts) {
    const ev = parseEvent(p);
    if (!ev) continue;
    if (ev.kind === 'stat') { endSweep(ev); continue; }
    if (ev.kind === 'error') { console.log(`[${time()}] ${ev.detail}`); continue; }
    if (ev.kind !== 'line') continue;
    for (const line of readMemoryFindings([ev.text]).lines) {
      if (!needsTranslation(line.text, ['cyrillic'])) continue;
      copies.push({
        text: line.text, channel: line.channel,
        form: ev.text.includes('ChatPersona') ? 'markup' : 'plain',
        addr: ev.addr, region: ev.region, regionSize: ev.regionSize, alloc: ev.alloc, isPrivate: ev.isPrivate,
        pollable: ev.isPrivate && ev.regionSize <= POLL_CAP,
      });
    }
  }
});
child.stderr.on('data', (d) => console.log(String(d).trim()));

const stop = () => { try { child.kill(); } catch { /* gone */ } console.log('Stopped. Rows are in whereis.log.'); process.exit(0); };
process.on('SIGINT', stop);
setTimeout(stop, RUN_MS);
console.log(`Sweeping ${processName} continuously for ${RUN_MS / 1000}s. Ctrl+C stops it sooner.`);
