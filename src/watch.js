// Terminal mode: node src/watch.js
// The same chain the overlay uses, printed to a console. Useful for a
// first run, and for checking the parser against a real game without
// Electron in the way.

import { loadConfig } from './config.js';
import { startWatching } from './watcher.js';

const cfg = loadConfig();
if (!cfg.geminiApiKey) {
  console.error('No Gemini API key. Put one in config.json or set GEMINI_API_KEY.');
  process.exit(1);
}

const time = () => new Date().toTimeString().slice(0, 8);

startWatching(cfg, {
  onStatus: (s) => console.log(`[${time()}] ${s.text}${s.file ? ' (' + s.file + ')' : ''}`),
  onResult: (row) => {
    console.log(`[${time()}] ${row.name}: ${row.en}`);
    if (cfg.showOriginal && row.translated) console.log(`           ${row.text}`);
  },
});

console.log('Watching. Ctrl+C to stop.');
