// The whole chain, timed: from a line being SAID in the game to it being
// SHOWN in the chat box (untranslated, at once) and TRANSLATED.
//
//   node tools/e2e.mjs [lines] [gapMs]        (default 8 lines, 4000ms)
//
// Runs the real reader and the real model with the settings in
// config.json, types numbered Russian lines into the game with
// tools/saychat.ps1, and prints both delays for each. Two lines go out
// 300ms apart and one is said twice, because a burst and a repeat are
// what a fight sounds like.
//
// It types into the game, reads its memory and SPENDS MODEL CALLS. Bot
// matches only, with the player's say-so.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { startWatchingMemory } from '../src/memwatcher.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COUNT = Number(process.argv[2] || 8);
const GAP = Number(process.argv[3] || 4000);
const cfg = loadConfig();
if (!cfg.geminiApiKey) { console.log('No Gemini key in config.json; nothing was started.'); process.exit(1); }

const PHRASES = ['идем на рошана', 'у кого есть дасты', 'отходим, их пятеро', 'керри фарми, мы держим',
  'смок и идем на мид', 'куплю гем после драки', 'нужны варды на боте', 'не ходите в лес'];
const run = String(Date.now()).slice(-4);
const plan = Array.from({ length: COUNT }, (_, i) => ({
  channel: i % 2 ? 'all' : 'team',
  text: `${PHRASES[i % PHRASES.length]} ${run}${i}`,
  // The third follows the second at once: a burst.
  waitMs: i === 0 ? 1000 : i === 2 ? 300 : GAP,
}));
// And the first line again at the end: a repeat, which the cache should
// answer with no call. (A different channel, or the tracker would - by
// design - not show the same words from the same player twice.)
plan.push({ channel: 'all', text: plan[0].text, waitMs: GAP });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-e2e-'));
const planFile = path.join(dir, 'plan.json');
const saidFile = path.join(dir, 'said.log');
fs.writeFileSync(planFile, JSON.stringify(plan));

const shown = new Map();        // text|channel -> ms
const done = new Map();         // text|channel -> { at, en, translated, cached }
const key = (r) => `${r.channel} ${r.text}`;
let started = false;

const watcher = startWatchingMemory(cfg, {
  onPending: (row) => { if (!shown.has(key(row))) shown.set(key(row), Date.now()); },
  onResult: (row) => {
    if (!shown.has(key(row))) shown.set(key(row), Date.now());        // a cached line is shown and done at once
    if (!done.has(key(row))) done.set(key(row), { at: Date.now(), en: row.en, translated: row.translated, cached: row.cached });
  },
  onStatus: (s) => {
    if (s.kind === 'find') console.log(`looked for the chat panel: ${s.find.panels} found, ${s.find.ms}ms ${s.find.mb}MB`);
    if (s.kind === 'error') console.log('error:', s.text);
    // The first stat means the backlog has been read past.
    if (s.kind === 'stat' && !started) { started = true; console.log(`reading (${s.stat.mode}). Typing ${plan.length} lines.`); setTimeout(type, 1500); }
  },
});

function type() {
  const sender = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'saychat.ps1'),
    '-Plan', planFile, '-Out', saidFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  sender.stdout.on('data', (d) => { const t = String(d).trim(); if (/NOT SENT|done/.test(t)) console.log('sender:', t); });
  sender.on('exit', () => setTimeout(report, 12000));
}

function report() {
  watcher.stop();
  const today = new Date();
  const said = fs.existsSync(saidFile) ? fs.readFileSync(saidFile, 'utf8').trim().split('\n').filter(Boolean) : [];
  const a = [], b = [];
  console.log('\nsaid          chan  ->shown  ->english');
  for (const row of said) {
    const [stamp, channel, ...rest] = row.split(' ');
    const text = rest.join(' ');
    const [h, m, s] = stamp.split(':');
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), +h, +m, 0, 0).getTime() + Number(s) * 1000;
    const k = `${channel} ${text}`;
    const sh = shown.get(k), dn = done.get(k);
    if (sh) a.push(sh - at);
    if (dn && dn.translated) b.push(dn.at - at);
    const ms = (v) => (v === undefined ? '  NEVER' : String(v).padStart(5) + 'ms');
    console.log(`${stamp}  ${channel.padEnd(4)}  ${ms(sh && sh - at)}  ${ms(dn && dn.at - at)}  ` +
      (dn ? (dn.translated ? dn.en : '(NOT TRANSLATED) ' + dn.en) + (dn.cached ? '   [cache]' : '') : ''));
  }
  const mid = (l) => (l.length ? l.sort((x, y) => x - y)[Math.floor(l.length / 2)] + 'ms' : '-');
  const worst = (l) => (l.length ? Math.max(...l) + 'ms' : '-');
  console.log(`\nshown:   ${a.length} of ${said.length}, median ${mid(a)}, worst ${worst(a)}`);
  console.log(`english: ${b.length} of ${said.length}, median ${mid(b)}, worst ${worst(b)}`);
  process.exit(0);
}

process.on('SIGINT', () => { watcher.stop(); process.exit(1); });
