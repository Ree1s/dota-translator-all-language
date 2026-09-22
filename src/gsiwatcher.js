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
import { startRowGrab } from './rowgrab.js';
import { layoutFromWindow } from './gsilayout.js';

export function startWatchingGsi(cfg, handlers = {}, { ensure = ensureGsiConfig, startSource = startGsiSource, watchFocus = startFocusWatch, grabRows = startRowGrab } = {}) {
  const port = Number.isInteger(cfg.gsiPort) && cfg.gsiPort > 1023 && cfg.gsiPort < 65536 ? cfg.gsiPort : GSI_PORT;
  const onStatus = handlers.onStatus || (() => {});
  const made = ensure({ port });
  // Who a speaker is: the feed gives a seat, the game's own chat row shows
  // the hero. A small screen grab, only with the game in front; gsiRowGrab:
  // false never captures anything.
  const rows = cfg.gsiRowGrab !== false && made.dotaDir ? grabRows({ dotaDir: made.dotaDir }) : null;
  const watcher = startWatchingMemory(cfg, { ...handlers, startSource: (o) => startSource({ ...o, port, identify: rows ? rows.identify : null, onSteamId: handlers.onSteamId || (() => {}) }) });
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
  // And where the game's chat is: the feed cannot say that either, and the
  // memory reader's answer came from the game's memory. The chat sits at a
  // fixed place in the game's picture, so the window's place and size give
  // it (src/gsilayout.js). Only the 'above' look: 'cover' needs the game's
  // real rows, which nothing here can know.
  const onWindow = (w) => {
    // The dark box has no layout from the game, but it can at least sit in
    // the game's WINDOW rather than on the screen.
    if (handlers.onWindow) handlers.onWindow(w);
    const l = cfg.display === 'above' && handlers.onLayout ? layoutFromWindow(w) : null;
    if (l) handlers.onLayout(l);
  };
  const focus = handlers.onFocus || handlers.onLayout || handlers.onHotkey ? watchFocus({ onFocus: handlers.onFocus || (() => {}), onWindow, onHotkey: handlers.onHotkey || (() => {}) }) : null;
  return { ...watcher, stop() { if (focus) focus.stop(); if (rows) rows.stop(); watcher.stop(); } };
}
