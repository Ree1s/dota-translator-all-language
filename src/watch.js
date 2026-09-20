// Terminal mode: node src/watch.js
// The same chain the overlay uses, printed to a console. Useful for a
// first run, and for checking the parser against a real game without
// Electron in the way.

import { loadConfig } from './config.js';
import { startWatching } from './watcher.js';
import { startWatchingMemory } from './memwatcher.js';

const cfg = loadConfig();
if (!cfg.geminiApiKey) {
  console.error('No Gemini API key. Put one in config.json or set GEMINI_API_KEY.');
  process.exit(1);
}

const time = () => new Date().toTimeString().slice(0, 8);

// 'memory' reads the running game, which is the only place chat actually
// is; 'log' is the old console.log reader, kept as a fallback.
const start = cfg.source === 'log' ? startWatching : startWatchingMemory;

start(cfg, {
  onStatus: (s) => {
    if (s.kind === 'stat') {
      const st = s.stat || {};
      console.log(`[${time()}] scan ${st.full ? 'full' : 'quick'} ${st.ms}ms ${st.mb}MB ${st.regions} regions, ${st.hot} hot`);
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
