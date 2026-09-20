// Terminal mode: node src/watch.js
// The same chain the overlay uses, printed to a console. Useful for a
// first run, and for checking the parser against a real game without
// Electron in the way.

import { loadConfig } from './config.js';
import { startWatching } from './watcher.js';
import { startWatchingMemory } from './memwatcher.js';
import { loadOffsets } from './offsets.js';

const cfg = loadConfig();
if (!cfg.geminiApiKey) {
  // A key saved by the setup window is encrypted for the app by Windows,
  // and a terminal cannot read it back.
  console.error(cfg.geminiApiKeyEnc
    ? 'The key was saved by the app, encrypted, and only the app can read it. For this terminal mode, set GEMINI_API_KEY.'
    : 'No Gemini API key. Run "npm start" and paste it into the window that opens, or set GEMINI_API_KEY.');
  process.exit(1);
}

cfg.offsets = await loadOffsets({ url: cfg.offsetsUrl });
console.log(`Offsets: ${cfg.offsets.source}, v${cfg.offsets.version} (${cfg.offsets.updated}).`);

const time = () => new Date().toTimeString().slice(0, 8);

// 'memory' reads the running game, which is the only place chat actually
// is; 'log' is the old console.log reader, kept as a fallback.
const start = cfg.source === 'log' ? startWatching : startWatchingMemory;

start(cfg, {
  onStatus: (s) => {
    if (s.kind === 'stat') {
      const st = s.stat || {};
      if (st.mode === 'panel') { console.log(`[${time()}] panel ${st.ms}ms ${st.kb}KB ${st.regions} children, ${st.hits} new`); return; }
      console.log(`[${time()}] scan ${st.mode || (st.full ? 'full' : 'quick')} ${st.ms}ms ${st.mb}MB ${st.regions} regions, ${st.hot} hot`);
      return;
    }
    if (s.kind === 'find') {
      console.log(`[${time()}] looked for the chat panel: ${s.find.panels} found, ${s.find.ms}ms ${s.find.mb}MB`);
      return;
    }
    console.log(`[${time()}] ${s.text}${s.file ? ' (' + s.file + ')' : ''}`);
  },
  onResult: (row) => {
    const where = row.channel === 'team' ? '[team] ' : row.channel === 'all' ? '[all]  ' : '';
    console.log(`[${time()}] ${where}${row.name}: ${row.en}`);
    if (cfg.showOriginal && row.translated) console.log(`           ${row.text}`);
  },
});

console.log('Watching. Ctrl+C to stop.');
