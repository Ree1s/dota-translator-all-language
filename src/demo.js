// Demo mode: node src/demo.js
//
// Writes a fake console.log in the shape Dota writes one, a line every
// couple of seconds, so the overlay can be set up and watched with no
// game running. It proves everything except the one thing only Dota can
// prove: that a real chat line looks the way parseChatLine expects.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const file = path.join(ROOT, 'demo-console.log');

// Engine noise and English chat are in here on purpose: nothing but the
// Russian lines should ever reach the overlay.
const SCRIPT = [
  'Host_Init: starting',
  'Kristjan: hey',
  'Иван: го рошан',
  'CDOTA_PlayerResource: 10 players',
  'Петя: мид сс, осторожно',
  'Vlad: ok',
  'Дима: у него бкб, не лезь',
  'Саня: дай фарм, я керри',
  '[Steam] connection established',
  'Игорь: ты вообще играть умеешь?',
  'Kristjan: going mid',
  'Олег: вард на речке поставь',
  'Женя: гг, фф в 20',
  'Миша: сорян, мой косяк',
  'Андрей: собираемся все, пушим мид',
];

fs.writeFileSync(file, '');   // a new game truncates the log
console.log('Fake log:', file);
console.log('\nPut this in config.json as "logPath" (forward slashes are fine):');
console.log('  "logPath": ' + JSON.stringify(file.split(path.sep).join('/')));
console.log('\nThen run "npm start" (overlay) or "npm run watch" (terminal) in another window.');
console.log('\nWriting a line every 2.5s. Ctrl+C to stop.\n');

let n = 0;
setInterval(() => {
  const line = SCRIPT[n % SCRIPT.length];
  n++;
  fs.appendFileSync(file, line + '\n');
  console.log('  wrote: ' + line);
}, 2500);
