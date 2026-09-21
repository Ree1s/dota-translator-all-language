// Does Dota's Game State Integration carry chat? A listener for the probe
// config (game/dota/cfg/gamestate_integration/gamestate_integration_dtprobe.cfg),
// which asks for every section anybody has ever named, real or hoped for.
//
//   node tools/gsiprobe.mjs [needle ...]
//
// Writes every payload to gsiprobe.log (one JSON per line), prints which
// top-level sections arrive, and says so the moment a payload contains any
// needle - a word typed into chat in a bot match. GSI is Valve's own,
// documented feed: this reads nothing out of the game and needs no say-so
// beyond the player's restart of Dota (configs are read at launch).
import http from 'node:http';
import fs from 'node:fs';

const PORT = 47853;
const needles = process.argv.slice(2).map((s) => s.toLowerCase());
const log = fs.createWriteStream('gsiprobe.log', { flags: 'a' });
const sections = new Map();
let payloads = 0;

http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200); res.end('ok');
    payloads++;
    log.write(body.replace(/\s+/g, ' ') + '\n');
    let data = null;
    try { data = JSON.parse(body); } catch { return; }
    for (const key of Object.keys(data)) {
      if (!sections.has(key)) { sections.set(key, payloads); console.log(new Date().toISOString().slice(11, 19), 'NEW SECTION:', key, '-', JSON.stringify(data[key]).slice(0, 160)); }
    }
    const low = body.toLowerCase();
    for (const n of needles) if (low.includes(n)) console.log(new Date().toISOString().slice(11, 19), '*** FOUND "' + n + '" in payload', payloads, '***', body.slice(Math.max(0, low.indexOf(n) - 200), low.indexOf(n) + 200).replace(/\s+/g, ' '));
  });
}).listen(PORT, '127.0.0.1', () => console.log('listening on 127.0.0.1:' + PORT + ', looking for:', needles.join(', ') || '(nothing - sections only)'));

setInterval(() => console.log(new Date().toISOString().slice(11, 19), payloads, 'payloads; sections:', [...sections.keys()].join(', ') || 'none yet'), 30000);
