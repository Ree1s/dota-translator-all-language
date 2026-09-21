// The app's own row matcher (src/rowgrab.ps1) against the chat grabs that
// tools/grabtest.mjs saved: the same code the app runs, on pictures whose
// answers are known. No game needed.
//
//   node tools/rowcheck.mjs [grabs]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROW_SCRIPT, writeRefs, SURE } from '../src/rowgrab.js';
import { findDotaDir } from '../src/gsiconfig.js';
import { POWERSHELL } from '../src/memsource.js';

const dir = process.argv[2] || 'grabs';
const refs = writeRefs(findDotaDir());
if (!refs) { console.log('no reference portraits: Dota not found'); process.exit(1); }
const rows = fs.readFileSync(path.join(dir, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => ({ ...r, file: fs.existsSync(r.file) ? r.file : path.join(dir, path.basename(r.file || '')) })).filter((r) => r.kind === 'chat' && fs.existsSync(r.file));

const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ROW_SCRIPT, '-Refs', refs], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const answers = [];
let wake = () => {};
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buffer += c;
  const parts = buffer.split(/\r?\n/); buffer = parts.pop();
  for (const p of parts) { try { answers.push(JSON.parse(p)); } catch { /* not ours */ } }
  wake();
});
const next = async () => { while (!answers.length) await new Promise((r) => { wake = r; }); return answers.shift(); };

console.log('helper:', JSON.stringify(await next()));
const votes = new Map();
let n = 0;
for (const r of rows) {
  // A chat grab began 410 units left of the centre line and 590 down.
  const s = r.scale;
  const t = Date.now();
  child.stdin.write(['file', ++n, ((410 - 362.25) * s).toFixed(2), ((735.75 - 590) * s).toFixed(2), (39.75 * s).toFixed(2), (24 * s).toFixed(2), path.resolve(r.file)].join(' ') + '\n');
  const a = await next();
  const e = r.event;
  console.log(`player_id ${e.playerId} ${JSON.stringify(e.text).slice(0, 30)} -> ${a.hero} ${a.score}${a.score >= SURE ? '' : ' (not sure)'}  next ${a.second} ${a.score2}  ${Date.now() - t}ms`);
  if (a.score >= SURE) { const k = e.matchid + ' player_id ' + e.playerId; votes.set(k, (votes.get(k) || new Set()).add(a.hero)); }
}
console.log('\nWHO SPOKE:');
for (const [k, v] of votes) console.log('  ' + k + ': ' + [...v].join(', ') + (v.size > 1 ? '   <-- TWO HEROES FOR ONE SPEAKER' : ''));
child.stdin.end();
