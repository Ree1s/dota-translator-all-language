// The overlay. A transparent, always on top, click-through window laid
// over the game. Dota must run in borderless windowed for anything to
// show above it: an exclusive fullscreen game owns the screen and no
// window can sit on it.

import { app, BrowserWindow, screen, ipcMain, globalShortcut } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { startWatching } from './watcher.js';
import { startWatchingMemory } from './memwatcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
let win = null;
let watcher = null;
let hidden = false;

function place(bounds) {
  const w = 520;
  const h = Math.min(bounds.height - 80, 60 + cfg.maxLines * 64);
  const pad = 24;
  const right = cfg.position.endsWith('right');
  const bottom = cfg.position.startsWith('bottom');
  return {
    x: bounds.x + (right ? bounds.width - w - pad : pad),
    y: bounds.y + (bottom ? bounds.height - h - pad : pad + 40),
    width: w,
    height: h,
  };
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    ...place(area),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true },
  });
  // "screen-saver" is the level that stays above a borderless game; the
  // default "floating" loses to it.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (cfg.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(here, 'overlay.html'));
  win.once('ready-to-show', () => {
    win.webContents.send('config', {
      holdSeconds: cfg.holdSeconds,
      maxLines: cfg.maxLines,
      showOriginal: cfg.showOriginal,
      fontSize: cfg.fontSize,
      opacity: cfg.opacity,
    });
    start();
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function start() {
  if (!cfg.geminiApiKey) {
    send('status', { kind: 'error', text: 'No Gemini API key. Put one in config.json.' });
    return;
  }
  // 'memory' reads the running game, which is the only place the chat
  // actually is; 'log' is the old console.log reader, kept as a fallback.
  const start = cfg.source === 'log' ? startWatching : startWatchingMemory;
  watcher = start(cfg, {
    onStatus: (s) => send('status', s),
    onResult: (row) => send('line', row),
  });
}

app.whenReady().then(() => {
  createWindow();
  // Alt+D hides and shows it, for a screenshot or a clear view of a fight.
  globalShortcut.register('Alt+D', () => {
    if (!win || win.isDestroyed()) return;
    hidden = !hidden;
    if (hidden) win.hide(); else win.showInactive();
  });
  globalShortcut.register('Alt+Shift+D', () => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.stop();
});

app.on('window-all-closed', () => app.quit());
ipcMain.on('quit', () => app.quit());
