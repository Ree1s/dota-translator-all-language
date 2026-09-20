// How long from a line being SAID to the reader FINDING it?
//
//   node tools/latency.mjs [lines] [gapMs]      (default 10 lines, 7000ms)
//
// Runs the real reader with the settings in config.json, types numbered
// Russian lines into the game with tools/saychat.ps1 (alternating team
// and all chat), and prints say -> found for each, with the kind of scan
// that found it. The model is not called: this measures the READER.
//
// It types into the game and reads its memory. Bot matches only, and
// only with the player's say-so.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { startMemorySource } from '../src/memsource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COUNT = Number(process.argv[2] || 10);
const GAP = Number(process.argv[3] || 7000);
const cfg = loadConfig();
// --no-reader: type the lines and measure the game with NO reader at all.
// The control for "is it the reader, or is it the typing".
const NO_READER = process.argv.includes('--no-reader');
const flag = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : Number(process.argv[i + 1]); };

const PHRASES = ['идем на рошана', 'у кого есть дасты', 'отходим, их пятеро', 'керри фарми, мы держим',
  'смок и идем на мид', 'куплю гем после драки', 'нужны варды на боте', 'не ходите в лес', 'пуш мид после драки', 'у них нет байбека'];
const run = String(Date.now()).slice(-4);
const plan = Array.from({ length: COUNT }, (_, i) => ({
  channel: i % 2 ? 'all' : 'team',
  text: `${PHRASES[i % PHRASES.length]} ${run}${i}`,
  waitMs: i === 0 ? 1000 : GAP,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-lat-'));
const planFile = path.join(dir, 'plan.json');
const saidFile = path.join(dir, 'said.log');
fs.writeFileSync(planFile, JSON.stringify(plan));

// Processor time used so far, in seconds: the game's, and the reader
// helper's (the PowerShell child of THIS process). Differences between
// two readings are what a stretch of time cost. One core busy for the
// whole stretch is 100%; the machine has os.cpus().length of them.
function cpuSeconds() {
  const script = "$d = Get-Process dota2 -ErrorAction SilentlyContinue | Select-Object -First 1; " +
    "$r = Get-CimInstance Win32_Process -Filter \"Name='powershell.exe' AND ParentProcessId=" + process.pid + "\" | " +
    "Where-Object { $_.CommandLine -match 'memscan' } | Select-Object -First 1; " +
    "$rc = 0; if ($r) { $rc = (Get-Process -Id $r.ProcessId).TotalProcessorTime.TotalSeconds }; " +
    "$dc = 0; if ($d) { $dc = $d.TotalProcessorTime.TotalSeconds }; Write-Output ($dc.ToString([cultureinfo]::InvariantCulture) + ' ' + $rc.ToString([cultureinfo]::InvariantCulture))";
  try {
    const [dota, reader] = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim().split(' ').map(Number);
    return { dota, reader, at: Date.now() };
  } catch { return null; }
}
const usage = (a, b, k) => (a && b ? (100 * (b[k] - a[k]) / ((b.at - a.at) / 1000)).toFixed(0) + '%' : '?');
let cpuA = null, cpuB = null, cpuC = null;

const found = new Map();      // text -> { at, mode, inWindow }
const stats = { full: [], wide: [], win: [] };
let ready = false;
let sender = null;

// The game must be in FRONT for the baseline. MEASURED the wrong way
// first: alt-tabbed it used 128% of a core, and "with the reader" 323% -
// which was the game being brought to the front to be typed into, not
// the reader.
const focused = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  path.join(HERE, 'saychat.ps1'), '-FocusOnly'], { encoding: 'utf8' }).trim();
if (focused !== 'focused') { console.log('Could not bring the game to the front; nothing was started.'); process.exit(2); }
await new Promise((r) => setTimeout(r, 5000));
console.log('Measuring the game alone, in front, for 15s...');
cpuA = cpuSeconds();
await new Promise((r) => setTimeout(r, 15000));
cpuB = cpuSeconds();

const source = NO_READER ? { stop() {} } : startMemorySource({
  scripts: cfg.scripts,
  intervalMs: cfg.scanIntervalMs,
  fullRescanMs: cfg.fullRescanMs,
  windowMb: cfg.scanWindowMb,
  wideEvery: flag('--wide-every') ?? cfg.scanWideEvery,
  wideCapMb: flag('--wide-cap') ?? cfg.scanWideCapMb,
  onMessage: (m) => { if (!found.has(m.text)) found.set(m.text, { at: Date.now() }); },
  onPlacement: (p) => { const f = found.get(p.text); if (f && !f.mode) { f.mode = p.mode; f.inWindow = p.inWindow; } },
  onStatus: (s) => { if (s.kind === 'error') console.log('reader:', s.text); },
  onStat: (st) => {
    (stats[st.mode] || stats.wide).push(st);
    if (!ready && st.full) { ready = true; console.log(`first sweep ${st.ms}ms ${st.mb}MB, ${st.hot} hot. Typing ${COUNT} lines, ${GAP}ms apart.`); setTimeout(startSender, 4000); }
  },
});

if (NO_READER) { console.log('No reader. Typing only.'); startSender(); }

function startSender() {
  sender = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'saychat.ps1'),
    '-Plan', planFile, '-Out', saidFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  sender.stdout.on('data', (d) => { const t = String(d).trim(); if (/NOT SENT|done/.test(t)) console.log('sender:', t); });
  sender.on('exit', () => setTimeout(report, Math.max(12000, cfg.scanIntervalMs * (cfg.scanWideEvery + 2))));
}

function report() {
  cpuC = cpuSeconds();
  source.stop();
  const today = new Date();
  const said = fs.existsSync(saidFile) ? fs.readFileSync(saidFile, 'utf8').trim().split('\n').filter(Boolean) : [];
  const lat = [];
  console.log('\nsaid          chan  say->found  found by');
  for (const row of said) {
    const [stamp, channel, ...rest] = row.split(' ');
    const text = rest.join(' ');
    const [h, m, s] = stamp.split(':');
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), +h, +m, 0, 0).getTime() + Number(s) * 1000;
    const f = found.get(text);
    if (f) lat.push(f.at - at);
    console.log(`${stamp}  ${channel.padEnd(4)}  ${f ? String(f.at - at).padStart(6) + 'ms' : '  NEVER '}   ${f ? `${f.mode || '?'}${f.inWindow ? ' (in window)' : ''}` : ''}`);
  }
  lat.sort((a, b) => a - b);
  const avg = (list, k) => list.length ? Math.round(list.reduce((n, x) => n + x[k], 0) / list.length) : 0;
  console.log(`\nfound ${lat.length} of ${said.length}` + (lat.length ? `, median ${lat[Math.floor(lat.length / 2)]}ms, worst ${lat[lat.length - 1]}ms` : ''));
  for (const k of ['win', 'wide', 'full']) console.log(`${k.padEnd(4)} scans: ${stats[k].length}, avg ${avg(stats[k], 'ms')}ms ${avg(stats[k], 'mb')}MB`);
  console.log(`
processor, as a share of ONE core (this machine has ${os.cpus().length}):`);
  console.log(`  game alone, 15s before the reader:  ${usage(cpuA, cpuB, 'dota')}`);
  console.log(`  game while the reader ran:          ${usage(cpuB, cpuC, 'dota')}`);
  console.log(`  the reader itself, sweep included:  ${usage(cpuB, cpuC, 'reader')}`);
  process.exit(0);
}

process.on('SIGINT', () => { try { sender && sender.kill(); } catch { /* gone */ } source.stop(); process.exit(1); });
