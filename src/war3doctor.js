import { discoverWar3, snapshot, changes } from './war3discovery.js';
import { createInterface } from 'node:readline/promises';
const found = discoverWar3();
console.log(JSON.stringify(found, null, 2));
const before = snapshot(found.roots);
console.log('Snapshot:', before.size, 'files');
for (const [file, info] of before) console.log(file, JSON.stringify(info));
if (!process.argv.includes('--once')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Send a unique test chat message in a bot/custom game, then return here and press Enter. ');
  rl.close();
  console.log(JSON.stringify(changes(before, snapshot(found.roots)), null, 2));
}
console.log('Incoming chat is NOT verified. Repeat with another unique message to establish a reliable source. No incoming adapter is enabled.');
