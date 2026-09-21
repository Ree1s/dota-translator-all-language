// Feeds recorded GSI payloads (gsiprobe.log, one per line) through the GSI
// reader, as if Dota were sending them. No game and no key needed.
//
//   node tools/gsireplay.mjs [file] [--all]
//
// --all shows every line, not only the ones in a language to translate.
import fs from 'node:fs';
import { createGsiChat, readGsiPayload } from '../src/gsisource.js';
import { SCRIPTS } from '../src/chatlog.js';

const args = process.argv.slice(2);
const all = args.includes('--all');
const file = args.find((a) => !a.startsWith('--')) || 'gsiprobe.log';
if (all) SCRIPTS.any = /./;

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
let said = 0, unparsed = 0;
const chat = createGsiChat({
  scripts: all ? ['any'] : ['cyrillic', 'han'],
  onMessage: (m) => { said++; console.log(`[${m.channel}] slot ${m.slot} ${m.name}${m.hero ? ' (' + m.hero + ')' : ''}: ${m.text}`); },
  onUnknownChannel: (n) => console.log('UNKNOWN channel_type', n),
});
// The first payload primes; a recording should not lose its first lines to that.
chat.payload('{"provider":{},"map":{"matchid":"primer"}}');
for (const l of lines) {
  try { JSON.parse(l); } catch { unparsed++; }
  if (readGsiPayload(l)) chat.payload(l);
}
console.log(`\n${lines.length} payloads (${unparsed} not valid JSON), ${said} lines said`);
