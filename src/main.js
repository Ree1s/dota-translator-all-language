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
let inFront = true;

// Where the chat box goes. A corner by default; boxX / boxY, as fractions
// of the screen (0-1) from its top-left, put it anywhere - which is what
// laying it OVER the game's own chat will need, later.
function place(bounds, c = cfg) {
  const w = Math.round(c.boxWidth);
  const h = Math.min(bounds.height - 80, 40 + c.maxLines * 52);
  const pad = 24;
  const right = c.position.endsWith('right');
  const bottom = c.position.startsWith('bottom') || c.position === 'chat';
  if (c.position === 'chat' && !(c.boxX >= 0 && c.boxY >= 0)) {
    // Directly above the game's own chat, growing upwards, so the English
    // is read where the eye already goes for chat. MEASURED on a 5120x1440
    // screen: Dota lays its HUD out in a centred 16:9 area, and its chat
    // lines begin 0.31 of the way across that area and sit between 0.64
    // and 0.70 of the way down the screen. NOT checked at 16:9, 16:10 or
    // 4:3, nor with the HUD flipped (minimap on the right).
    const hudW = Math.min(bounds.width, Math.round(bounds.height * 16 / 9));
    const hudX = bounds.x + Math.round((bounds.width - hudW) / 2);
    return { x: hudX + Math.round(0.31 * hudW), y: bounds.y + Math.round(0.625 * bounds.height) - h, width: w, height: h };
  }
  if (c.boxX >= 0 && c.boxY >= 0) {
    return {
      x: Math.round(bounds.x + c.boxX * bounds.width),
      // Bottom-anchored, boxY is where the box ENDS: it grows upwards.
      y: Math.round(bounds.y + c.boxY * bounds.height - (bottom ? h : 0)),
      width: w,
      height: h,
    };
  }
  return {
    x: bounds.x + (right ? bounds.width - w - pad : pad),
    // 150 down, not 40: Dota keeps K/D/A and last hits in its top-left.
    y: bounds.y + (bottom ? bounds.height - h - pad : pad + 150),
    width: w,
    height: h,
  };
}

function createWindow() {
  // The whole display, not the work area: a borderless game covers the
  // taskbar, and the box is placed against the game.
  const area = screen.getPrimaryDisplay().bounds;
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
      position: cfg.position,
      display: cfg.display,
    });
    start();
  });
}

// DT_DEBUG=1 prints everything sent to the chat box, for the day it shows
// nothing and the question is whether it was ever told anything.
const DEBUG = Boolean(process.env.DT_DEBUG);

// COVER mode: the window is laid exactly over the game's own chat lines,
// from where the GAME says they are. MEASURED on 5120x1440 (scale 1.33):
// the line box begins 42px right of HudChat's x and the newest line ends
// 187px below HudChat's y - 31.5 and 140 in the 1080-high units Dota's
// layout is written in, which is why they are multiplied by the scale
// the game reports rather than kept as pixels. NOT checked on any other
// screen; that they are layout constants is the bet.
const CHAT_LEFT = 31.5, CHAT_BOTTOM = 140, LINE_BOX = 1000, ROWS_HIGH = 340;
// ABOVE mode: the same place, one chat-height higher. The game draws its
// chat in a window 216px high at scale 1.33 (162 units: six lines, which
// is also what it shows when the chat is OPENED), so a box that ends
// where that window begins has nothing of the game's under it, ever -
// which is the whole reason for it. Laying English OVER the lines worked
// but needed a strip to hide the Russian, a guess at when the game's line
// fades (wrong once already), and a signal for the opened chat that was
// not found.
const CHAT_HIGH = 162, GAP = 4;
let coverAt = '';

function coverBounds(l) {
  const lift = cfg.display === 'above' ? CHAT_HIGH + GAP : 0;
  const px = {
    x: Math.round(l.x + CHAT_LEFT * l.scale),
    y: Math.round(l.y + (CHAT_BOTTOM - ROWS_HIGH - lift) * l.scale),
    width: Math.round(LINE_BOX * l.scale),
    height: Math.round(ROWS_HIGH * l.scale),
  };
  // The game speaks in screen pixels and Electron in scaled ones; they
  // differ whenever Windows display scaling is not 100%.
  return screen.screenToDipRect ? screen.screenToDipRect(null, px) : px;
}

function onLayout(l) {
  if ((cfg.display !== 'cover' && cfg.display !== 'above') || !win || win.isDestroyed()) return;
  const b = coverBounds(l);
  const key = [b.x, b.y, b.width, b.height].join();
  if (key !== coverAt) { coverAt = key; win.setBounds(b); }
  // The renderer works in ITS pixels: the scale it needs is the game's
  // scale shrunk by whatever Windows scaling stretched the window by.
  const dip = b.width / Math.round(LINE_BOX * l.scale);
  send('layout', { rows: l.rows.map((r) => ({ ...r, height: r.height * dip, width: r.width * dip })), scale: l.scale * dip });
}

function send(channel, payload) {
  if (DEBUG && channel !== 'seen' && (channel !== 'status' || payload.text)) console.log(new Date().toISOString().slice(11, 23), channel, JSON.stringify(payload));
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function start() {
  if (!cfg.geminiApiKey) {
    send('status', { kind: 'error', text: 'No Gemini API key. Put one in config.json.' });
    return;
  }
  if (cfg.display === 'replace') {
    send('status', { kind: 'error', text: 'Replacing the game chat in place is not built yet - using the chat box.' });
  }
  // 'memory' reads the running game, which is the only place the chat
  // actually is; 'log' is the old console.log reader, kept as a fallback.
  const start = cfg.source === 'log' ? startWatching : startWatchingMemory;
  watcher = start(cfg, {
    onStatus: (s) => send('status', s),
    onPending: (row) => send('pending', row),
    onLayout,
    onSeen: (s) => { if (cfg.display === 'cover') send('seen', s); },
    // Up only while the game is the window in front.
    onFocus: (on) => {
      inFront = on;
      if (!win || win.isDestroyed() || hidden) return;
      if (on) win.showInactive(); else win.hide();
    },
    onResult: (row) => send('line', row),
  });
}

app.whenReady().then(() => {
  createWindow();
  // Alt+D hides and shows it, for a screenshot or a clear view of a fight.
  globalShortcut.register('Alt+D', () => {
    if (!win || win.isDestroyed()) return;
    hidden = !hidden;
    if (hidden) win.hide(); else if (inFront) win.showInactive();
  });
  globalShortcut.register('Alt+Shift+D', () => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.stop();
});

app.on('window-all-closed', () => app.quit());
ipcMain.on('quit', () => app.quit());
