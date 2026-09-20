// The real reader, with the model left out: every line it hears, every
// stat and every search for the chat panel, with a time to the
// millisecond. For checking the PANEL reader against the stand-in
// (tools/fakechat.ps1) or a bot match.
//
//   node tools/panelwatch.mjs [processName] [seconds] [--no-panel]
//
// It reads the game's memory when pointed at it: with say-so only.

import { startMemorySource } from '../src/memsource.js';

const processName = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'dota2';
const seconds = Number(process.argv[3]) || 30;
const time = () => new Date().toISOString().slice(11, 23);

const source = startMemorySource({
  processName,
  scripts: ['cyrillic'],
  panel: !process.argv.includes('--no-panel'),
  // --offsets "uiClient=8;...": what the app would pass after fetching offsets.json
  offsets: process.argv.includes('--offsets') ? process.argv[process.argv.indexOf('--offsets') + 1] : undefined,
  onMessage: (m) => console.log(`${time()}  LINE  [${m.channel}] ${m.name}: ${m.text}`),
  onStatus: (s) => console.log(`${time()}  ${s.kind}  ${s.text}`),
  onFind: (f) => console.log(`${time()}  find  ${f.panels} panel(s), ${f.ms}ms, ${f.mb}MB`),
  onStat: (st) => console.log(`${time()}  stat  ${st.mode} ${st.ms}ms ` +
    (st.mode === 'panel' ? `${st.kb}KB ${st.hits} new  [${st.panels}]` : `${st.mb}MB ${st.hits} hits`)),
  onUnknownTag: (tag) => console.log(`${time()}  UNKNOWN TAG  ${tag}`),
});

setTimeout(() => { source.stop(); process.exit(0); }, seconds * 1000);
