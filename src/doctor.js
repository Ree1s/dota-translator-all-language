// Diagnostic: node src/doctor.js
//
// Answers the one question the whole project rests on: does Dota write
// console.log WHILE the game runs, or only when it exits? Needs no API
// key and translates nothing - it only watches the file and reports.
//
// Run it with Dota open, play a bot match, type in chat, and watch.

import fs from 'node:fs';
import path from 'node:path';
import { findLogPath, parseChatLine, needsTranslation, LogTail } from './chatlog.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const file = cfg.logPath || findLogPath();
const clock = () => new Date().toTimeString().slice(0, 8);
const say = (s) => console.log(s);

say('');
say('  Paperbook Dota translator - log diagnostic');
say('  ------------------------------------------');

if (!file) {
  say('');
  say('  X  Could not find Dota 2 console.log.');
  say('');
  say('     Looked in the usual Steam locations. If Dota is on another');
  say('     drive, find the file yourself and put its path in config.json:');
  say('');
  say('       "logPath": "D:/Steam/steamapps/common/dota 2 beta/game/dota/console.log"');
  say('');
  say('     It only exists once Dota has run ONCE with -condebug set.');
  process.exit(1);
}

say('');
say('  Log file: ' + file);

let exists = fs.existsSync(file);
if (!exists) {
  say('');
  say('  !  The file is not there yet.');
  say('     Either -condebug is not set, or Dota has not been started');
  say('     since you set it. Add it to the launch options and restart');
  say('     Dota. This will keep watching.');
} else {
  const st = fs.statSync(file);
  const age = Math.round((Date.now() - st.mtimeMs) / 1000);
  say('  Size now: ' + st.size.toLocaleString() + ' bytes');
  say('  Last written: ' + age + 's ago');
}

say('');
say('  Now: start a BOT MATCH, press Enter in game, and send a few lines.');
say('  Paste Russian for the full test, for example:  го рошан');
say('');
say('  Watching. Ctrl+C to stop.');
say('');

let lastSize = exists ? fs.statSync(file).size : 0;
let grewWhileRunning = false;
let chatSeen = 0;
let cyrillicSeen = 0;
let lines = 0;

// Report growth on its own clock, so "the file moved" is visible even
// when nothing in it parses as chat.
setInterval(() => {
  let st = null;
  try { st = fs.statSync(file); } catch { /* still not there */ }
  if (!st) return;
  if (!exists) {
    exists = true;
    say(`[${clock()}]  the log appeared (${st.size} bytes)`);
    lastSize = st.size;
    return;
  }
  if (st.size === lastSize) return;
  const delta = st.size - lastSize;
  lastSize = st.size;
  if (delta > 0 && !grewWhileRunning) {
    grewWhileRunning = true;
    say('');
    say(`[${clock()}]  *** THE LOG IS BEING WRITTEN LIVE. This is the answer we wanted. ***`);
    say('');
  }
  say(`[${clock()}]  +${delta} bytes`);
}, 1000);

const tail = new LogTail(file, { intervalMs: 500 });
tail.onLine = (line) => {
  lines++;
  const chat = parseChatLine(line);
  const cyr = needsTranslation(line, cfg.scripts);
  if (chat) {
    chatSeen++;
    say(`[${clock()}]  CHAT  ${chat.name}: ${chat.text}`);
  }
  if (cyr && !chat) {
    cyrillicSeen++;
    // A foreign line the parser did NOT take as chat is the thing that
    // would tell us the format is not "Name: message".
    say(`[${clock()}]  FOREIGN LINE THE PARSER MISSED - send this to Claude:`);
    say(`             ${JSON.stringify(line)}`);
  }
};
tail.onError = () => {};
tail.start();

function report() {
  say('');
  say('  ------------------------------------------');
  say('  Lines read while watching: ' + lines);
  say('  Parsed as chat: ' + chatSeen);
  say('  Foreign lines the parser missed: ' + cyrillicSeen);
  say('');
  if (grewWhileRunning) {
    say('  VERDICT: the log grew while Dota was running. Live reading works.');
  } else {
    say('  VERDICT: the log never grew while you watched.');
    say('           If you were in a game and typed in chat, Dota is');
    say('           buffering it until the client exits, and the log');
    say('           approach cannot work. Try con_logfile as plan B.');
  }
  say('');
  process.exit(0);
}

process.on('SIGINT', report);
