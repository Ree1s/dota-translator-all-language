// The whole chain with chat from Dota's GSI feed instead of its memory
// (`source: "gsi"`). Everything after the source is memwatcher's, unchanged.
//
// The memory reader stays the default until this has been through whole
// games: what GSI has NOT been seen to carry is in CLAUDE.md.

import path from 'node:path';
import { startWatchingMemory } from './memwatcher.js';
import { startGsiSource, GSI_PORT } from './gsisource.js';
import { ensureGsiConfig } from './gsiconfig.js';
import { startFocusWatch } from './focuswatch.js';

export function startWatchingGsi(cfg, handlers = {}, { ensure = ensureGsiConfig, startSource = startGsiSource, watchFocus = startFocusWatch } = {}) {
  const port = Number.isInteger(cfg.gsiPort) && cfg.gsiPort > 1023 && cfg.gsiPort < 65536 ? cfg.gsiPort : GSI_PORT;
  const onStatus = handlers.onStatus || (() => {});
  const made = ensure({ port });
  const watcher = startWatchingMemory(cfg, { ...handlers, startSource: (o) => startSource({ ...o, port }) });
  if (made.state === 'written') {
    onStatus({ kind: 'error', text: 'Dota Translator has set up Dota\'s chat feed. Restart Dota once - it only reads that setting when it starts.' });
  } else if (made.state === 'notfound') {
    onStatus({ kind: 'error', text: 'Could not find where Dota 2 is installed, so its chat feed is not set up.' });
  } else if (made.state === 'failed') {
    onStatus({ kind: 'error', text: 'Could not write Dota\'s chat feed setting: ' + made.detail });
  }
  // Where the game's own portraits and font are: the memory helper reports
  // the exe for this, and here the install folder is already known.
  if (made.dotaDir && handlers.onGamePath) handlers.onGamePath(path.join(made.dotaDir, '..', 'bin', 'win64', 'dota2.exe'));
  // Whether the game is in front: the overlay hides on it and the say-back
  // key exists only then. The feed cannot say; Windows can.
  const focus = handlers.onFocus ? watchFocus({ onFocus: handlers.onFocus }) : null;
  return { ...watcher, stop() { if (focus) focus.stop(); watcher.stop(); } };
}
