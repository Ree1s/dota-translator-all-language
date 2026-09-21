// Reads what tools/grabtest.mjs collected and says what was in it:
// seat -> hero from every top-bar grab, and for every chat line the hero
// whose portrait stood beside the game's newest chat row - and so that
// speaker's SEAT (and colour), whatever number the feed gave them.
//
//   node tools/grabmatch.mjs [grabs]
//
// Every tile is compared with ALL the game's own hero portraits (read from
// the player's pak01 by src/heroface.js - disk, not the process), not only
// the ten in the match: a harder test than the app would need.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { faces, readIndex } from '../src/heroface.js';
import { findDotaDir } from '../src/gsiconfig.js';
import { SLOT_NAMES } from '../src/gsisource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || 'grabs';
const refs = path.join(dir, 'refs');

if (!fs.existsSync(refs) || fs.readdirSync(refs).length < 100) {
  const dota = findDotaDir();
  if (!dota) { console.log('Dota not found'); process.exit(1); }
  fs.mkdirSync(refs, { recursive: true });
  const face = faces(dota);
  let n = 0;
  for (const hero of readIndex(path.join(dota, 'pak01_dir.vpk')).keys()) {
    const m = /^data:image\/(png|bmp);base64,(.*)$/.exec(face(hero) || '');
    if (m) { fs.writeFileSync(path.join(refs, hero + '.' + m[1]), Buffer.from(m[2], 'base64')); n++; }
  }
  console.log(n + ' reference portraits written');
}

function match(image, tiles, slack) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'grabmatch.ps1'),
    '-Image', path.resolve(image), '-Refs', path.resolve(refs), '-Tiles', tiles.map((t) => [t.name, t.x, t.y, t.w, t.h].join(':')).join(';'), '-Slack', String(slack)], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [name, hero, score, second, score2] = l.split(' ');
    return { name, hero, score: Number(score), second, score2: Number(score2) };
  });
}

// MEASURED on 5120x1440 (scale 1.333), in 1080-high units from the centre
// line: a top-bar tile is 60 x 34.5, 62.25 apart, radiant's first 416.25
// left of centre and dire's first 107.25 right of it, 4.5 down. The
// portrait of the newest chat row is 39.75 x 24 at 362.25 left, 735.75 down.
const rows = fs.readFileSync(path.join(dir, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => fs.existsSync(r.file));
const SURE = 0.8;
let seats = null;
const speakers = new Map();

for (const r of rows) {
  const s = r.scale;
  const centre = r.w / 2;          // a top grab is cut evenly about the screen's centre line
  if (r.kind === 'top') {
    const tiles = [];
    for (let i = 0; i < 5; i++) {
      tiles.push({ name: 'seat' + i, x: Math.round(centre + (-416.25 + 62.25 * i) * s), y: Math.round(4.5 * s), w: Math.round(60 * s), h: Math.round(34.5 * s) });
      tiles.push({ name: 'seat' + (5 + i), x: Math.round(centre + (107.25 + 62.25 * i) * s), y: Math.round(4.5 * s), w: Math.round(60 * s), h: Math.round(34.5 * s) });
    }
    const found = match(r.file, tiles, 6).sort((a, b) => Number(a.name.slice(4)) - Number(b.name.slice(4)));
    const sure = found.filter((f) => f.score >= SURE).length;
    console.log(`\n${r.at.slice(11, 19)} top bar: ${sure}/10 sure`);
    console.log('  ' + found.map((f) => `${f.name.slice(4)}:${f.hero}${f.score >= SURE ? '' : '?(' + f.score.toFixed(2) + ')'}`).join('  '));
    if (sure === 10) seats = found.map((f) => f.hero);
  } else if (r.kind === 'chat') {
    // The grab began 410 units left of centre and 590 down.
    const tile = { name: 'speaker', x: Math.round((410 - 362.25) * s), y: Math.round((735.75 - 590) * s), w: Math.round(39.75 * s), h: Math.round(24 * s) };
    const [f] = match(r.file, [tile], 8);
    const seat = seats && f.score >= SURE ? seats.indexOf(f.hero) : -1;
    const e = r.event;
    console.log(`${r.at.slice(11, 19)} +${r.after}ms player_id ${e.playerId} ${JSON.stringify(e.text).slice(0, 40)} -> ${f.hero} ${f.score.toFixed(2)} (next ${f.second} ${f.score2.toFixed(2)})${seat >= 0 ? ' = seat ' + seat + ' ' + SLOT_NAMES[seat] : ''}`);
    if (f.score >= SURE) {
      const key = e.matchid + ' player_id ' + e.playerId;
      const votes = speakers.get(key) || new Map();
      const what = f.hero + (seat >= 0 ? ' seat ' + seat + ' ' + SLOT_NAMES[seat] : '');
      votes.set(what, (votes.get(what) || 0) + 1);
      speakers.set(key, votes);
    }
  }
}

console.log('\nWHO SPOKE, by the feed\'s number:');
for (const [key, votes] of speakers) console.log('  ' + key + ': ' + [...votes].map(([k, n]) => `${k} x${n}`).join(', '));
