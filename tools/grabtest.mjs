// THE SCREEN-GRAB TEST: can the hero and colour of whoever speaks be told
// from the screen alone, with no memory read? Run it during a game, beside
// tools/gsiprobe.mjs (which must be running: this follows gsiprobe.log).
//
//   node tools/grabtest.mjs            collect, until Ctrl+C
//   node tools/grabmatch.mjs           afterwards: what was in the grabs
//
// It saves two kinds of small PNG into grabs/ (gitignored):
//   top   the game's top bar - ten portraits in seat order, each under its
//         seat's colour - every 30 seconds
//   chat  the game's own chat window, 0.3s and 1.2s after the feed reports a
//         line: the newest row has the speaker's portrait beside it
// and one line per grab in grabs/index.jsonl. Screen capture only. It
// assumes the game covers the primary screen (borderless), as the numbers
// below were measured: 5120x1440, top bar and chat in 1080-high units from
// the screen's centre line.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGsiPayload } from '../src/gsisource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG = 'gsiprobe.log';
const OUT = 'grabs';
fs.mkdirSync(OUT, { recursive: true });
const index = fs.createWriteStream(path.join(OUT, 'index.jsonl'), { flags: 'a' });

const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'grab.ps1')], { stdio: ['pipe', 'pipe', 'inherit'] });
ps.stdout.setEncoding('utf8');
let screen = null, buffer = '', grabs = 0;
ps.stdout.on('data', (d) => {
  buffer += d;
  const lines = buffer.split(/\r?\n/); buffer = lines.pop();
  for (const l of lines) {
    const m = /^screen (\d+) (\d+)$/.exec(l);
    if (m) { screen = { w: Number(m[1]), h: Number(m[2]) }; console.log('screen', screen.w + 'x' + screen.h); begin(); }
    else if (l.startsWith('failed')) console.log(l);
  }
});

const stamp = () => new Date().toISOString().slice(11, 23).replace(/[:.]/g, '');
function grab(kind, region, extra = {}) {
  const file = path.join(OUT, `${kind}-${stamp()}.png`);
  ps.stdin.write(`${region.x} ${region.y} ${region.w} ${region.h} ${path.resolve(file)}\n`);
  index.write(JSON.stringify({ kind, file, ...region, scale: screen.h / 1080, at: new Date().toISOString(), ...extra }) + '\n');
  grabs++;
}

function begin() {
  const s = screen.h / 1080, cx = screen.w / 2;
  const u = (n) => Math.round(n * s);
  const top = { x: Math.round(cx - u(450)), y: 0, w: u(900), h: u(50) };
  const chat = { x: Math.round(cx - u(410)), y: u(590), w: u(800), h: u(185) };
  grab('top', top);
  setInterval(() => grab('top', top), 30000);

  // Follow the probe's log from where it ends now.
  let at = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0, tail = '';
  const seen = new Set();
  let primed = false;
  setInterval(() => {
    let size = 0;
    try { size = fs.statSync(LOG).size; } catch { return; }
    if (size <= at) return;
    const fd = fs.openSync(LOG, 'r');
    const buf = Buffer.alloc(size - at);
    fs.readSync(fd, buf, 0, buf.length, at); fs.closeSync(fd);
    at = size;
    tail += buf.toString('utf8');
    const lines = tail.split('\n'); tail = lines.pop();
    for (const l of lines) {
      const p = readGsiPayload(l);
      if (!p) continue;
      for (const c of p.chat) {
        const key = p.matchid + '|' + c.gameTime + '|' + c.slot + '|' + c.text;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!primed) continue;
        const event = { matchid: p.matchid, playerId: c.slot, channelType: c.channelType, text: c.text, gameTime: c.gameTime };
        console.log(new Date().toTimeString().slice(0, 8), 'line from player', c.slot, JSON.stringify(c.text));
        setTimeout(() => grab('chat', chat, { event, after: 300 }), 300);
        setTimeout(() => grab('chat', chat, { event, after: 1200 }), 1200);
      }
      primed = true;
    }
  }, 250);
  console.log('grabbing into ' + OUT + '/ - Ctrl+C to stop');
}

process.on('SIGINT', () => { console.log('\n' + grabs + ' grabs'); try { ps.stdin.end(); } catch { /* gone */ } process.exit(0); });
