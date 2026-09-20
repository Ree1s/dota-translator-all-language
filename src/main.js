// The overlay. A transparent, always on top, click-through window laid
// over the game. Dota must run in borderless windowed for anything to
// show above it: an exclusive fullscreen game owns the screen and no
// window can sit on it.

import { app, BrowserWindow, screen, ipcMain, globalShortcut, safeStorage, shell, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, saveConfig, onDisk } from './config.js';
import { checkKey, tidyKey } from './keycheck.js';
import updater from 'electron-updater';
import { startWatching } from './watcher.js';
import { startWatchingMemory } from './memwatcher.js';
import { loadOffsets, bundledOffsets } from './offsets.js';

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
  // On every load, not once: changing the look in the setup window reloads
  // this page, and a fresh page knows nothing.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('config', {
      holdSeconds: cfg.holdSeconds,
      maxLines: cfg.maxLines,
      showOriginal: cfg.showOriginal,
      showHeroes: cfg.showHeroes,
      fontSize: cfg.fontSize,
      opacity: cfg.opacity,
      position: cfg.position,
      display: cfg.display,
      fadeWithGame: cfg.fadeWithGame,
      textLeft: TEXT_LEFT,
    });
    if (lastFonts) win.webContents.send('fonts', lastFonts);
    if (!started) { started = true; start(); }
  });
}

let started = false;
let lastFonts = '';

// The look changed in the setup window: put the window back where that
// look wants it and start its page again, clean.
function applyDisplay(display) {
  if (display === cfg.display || !win || win.isDestroyed()) { cfg.display = display; return; }
  cfg.display = display;
  coverAt = '';
  win.setBounds(place(screen.getPrimaryDisplay().bounds));
  win.reload();
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
// The three that were calibrated by eye live in offsets.json with the
// memory offsets, for the same reason: if a patch restyles the chat they
// are fixed by a commit there. These are what shipped, until it is read.
let { chatLeft: CHAT_LEFT, chatBottom: CHAT_BOTTOM, chatHigh: CHAT_HIGH, textLeft: TEXT_LEFT } = bundledOffsets().layout;
const LINE_BOX = 1000, ROWS_HIGH = 340;
// ABOVE mode: the same place, one chat-height higher. The game draws its
// chat in a window 216px high at scale 1.33 (162 units: six lines, which
// is also what it shows when the chat is OPENED), so a box that ends
// where that window begins has nothing of the game's under it, ever -
// which is the whole reason for it. Laying English OVER the lines worked
// but needed a strip to hide the Russian, a guess at when the game's line
// fades (wrong once already), and a signal for the opened chat that was
// not found.
const GAP = 4;
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

function restartWatcher() {
  if (watcher) { watcher.stop(); watcher = null; }
  start();
}

async function start() {
  // A few seconds at most, and never fatal: see src/offsets.js.
  if (!cfg.offsets) cfg.offsets = await loadOffsets({ url: cfg.offsetsUrl });
  ({ chatLeft: CHAT_LEFT, chatBottom: CHAT_BOTTOM, chatHigh: CHAT_HIGH, textLeft: TEXT_LEFT } = cfg.offsets.layout);
  send('config', { textLeft: TEXT_LEFT });
  if (DEBUG) console.log('offsets', cfg.offsets.source, 'v' + cfg.offsets.version, cfg.offsets.updated);
  cfg.geminiApiKey = storedKey();
  if (!cfg.geminiApiKey) {
    // Not an error to be read off an overlay: a window that asks for it.
    openSetup();
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
    // The game's chat is set in Valve's Radiance, which is not on anybody's
    // machine except inside the game. It is loaded from THERE - the
    // player's own copy - and never copied into this repo.
    onGamePath: (exe) => {
      // dota2.exe is in game/bin/win64; the fonts are in game/dota/panorama/fonts.
      const dir = path.resolve(path.dirname(exe), '..', '..', 'dota', 'panorama', 'fonts');
      if (fs.existsSync(path.join(dir, 'radiance-bold.otf'))) { lastFonts = pathToFileURL(dir).href; send('fonts', lastFonts); }
    },
    // Up only while the game is the window in front.
    onFocus: (on) => {
      inFront = on;
      if (!win || win.isDestroyed() || hidden) return;
      if (on) win.showInactive(); else win.hide();
    },
    onResult: (row) => send('line', row),
  });
}

// ---- UPDATES ---------------------------------------------------------
// The INSTALLED app keeps itself up to date from the project's GitHub
// releases (the user asked: "the app should auto update when start"). It
// looks once at startup, downloads a newer version quietly in the
// background and installs it when the app is next closed - never in the
// middle of a match, and never with a dialog over the game. Run from
// source there is nothing to update and nothing is asked.
function checkForUpdates() {
  if (!app.isPackaged || cfg.autoUpdate === false) return;
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (err) => { if (DEBUG) console.log('update:', String((err && err.message) || err)); });
  autoUpdater.on('update-downloaded', (info) => {
    if (tray) tray.setToolTip('Dota Translator - version ' + info.version + ' installs when you quit');
  });
  autoUpdater.checkForUpdates().catch(() => { /* offline, or no release yet: next time */ });
}

app.whenReady().then(() => {
  createWindow();
  checkForUpdates();
  // Alt+D hides and shows it, for a screenshot or a clear view of a fight.
  globalShortcut.register('Alt+D', toggleHidden);
  makeTray();
  globalShortcut.register('Alt+Shift+D', () => app.quit());
});

// ---- THE SETUP WINDOW ------------------------------------------------
// Where a player gives the app its key without ever seeing config.json
// (the user, 2026-09-20: "simpler for non techie user to just enter api
// key in the ui"). It opens by itself when there is no key, and from the
// tray icon after that. The key is TRIED before it is saved - one real
// translation - so "saved" means "works", and it is stored encrypted by
// Windows for this user (safeStorage = DPAPI) rather than in plain text.
let setupWin = null;
let tray = null;

function storedKey() {
  if (cfg.geminiApiKey) return cfg.geminiApiKey;            // config.json or GEMINI_API_KEY, in plain
  if (!cfg.geminiApiKeyEnc || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(cfg.geminiApiKeyEnc, 'base64')); } catch { return ''; }
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
  setupWin = new BrowserWindow({
    // Wide enough that nothing wraps awkwardly; the HEIGHT is whatever the
    // page turns out to need (fitSetup) - a fixed one was a guess, and the
    // guess was short: the window scrolled.
    width: 680, height: 720, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false,
    title: 'Dota Translator', backgroundColor: '#0a0d10', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(here, 'setup-preload.cjs'), contextIsolation: true, sandbox: true },
  });
  setupWin.removeMenu();
  setupWin.loadFile(path.join(here, 'setup.html'));
  setupWin.once('ready-to-show', async () => { await fitSetup(); if (setupWin && !setupWin.isDestroyed()) setupWin.show(); });
  // Nothing in this window goes anywhere but the page it was given.
  setupWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupWin.webContents.on('will-navigate', (e) => e.preventDefault());
  setupWin.on('closed', () => { setupWin = null; });
}

// Make the setup window exactly as tall as its page, capped to the screen.
// Asked again when the page says its content changed (a result appearing).
async function fitSetup() {
  if (!setupWin || setupWin.isDestroyed()) return;
  try {
    const want = await setupWin.webContents.executeJavaScript('Math.ceil(document.body.getBoundingClientRect().height)');
    const room = screen.getPrimaryDisplay().workAreaSize.height - 60;
    const [w] = setupWin.getContentSize();
    setupWin.setContentSize(w, Math.max(400, Math.min(want, room)));
    // DT_SHOT=<file>: the window photographs itself - the only way to look
    // at it while a game covers the screen.
    if (process.env.DT_SHOT) setTimeout(async () => { try { fs.writeFileSync(process.env.DT_SHOT, (await setupWin.webContents.capturePage()).toPNG()); } catch { /* closed */ } }, 600);
    if (DEBUG) console.log('setup window: page needs', want, 'screen allows', room, '-> content', setupWin.getContentSize().join('x'));
    setupWin.center();
  } catch { /* closed meanwhile */ }
}
ipcMain.handle('setup:fit', fitSetup);

function makeTray() {
  // The app's own icon: two chat bubbles, what was said behind what you
  // read. Drawn for this project (build/icon-source.html) - NOT Dota's
  // logo, which is Valve's trademark and not ours to use.
  tray = new Tray(nativeImage.createFromPath(path.join(here, 'tray.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Dota Translator');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings and key...', click: openSetup },
    { label: 'Hide or show the translations (Alt+D)', click: toggleHidden },
    { label: 'Version ' + app.getVersion(), enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', openSetup);
}

function toggleHidden() {
  if (!win || win.isDestroyed()) return;
  hidden = !hidden;
  if (hidden) win.hide(); else if (inFront) win.showInactive();
}

ipcMain.handle('setup:state', () => ({ hasKey: Boolean(storedKey()), display: cfg.display }));
ipcMain.handle('setup:close', () => { if (setupWin && !setupWin.isDestroyed()) setupWin.close(); });
ipcMain.handle('setup:guide', () => {
  // The copy that came with the app: it is there with no internet, and it
  // is the one that matches this version.
  shell.openExternal(pathToFileURL(onDisk(path.join(here, '..', 'docs', 'key.html'))).href);
});
ipcMain.handle('setup:save', async (_e, payload) => {
  const display = payload && payload.display === 'box' ? 'box' : 'above';
  const typed = tidyKey(payload && payload.key);
  // No new key typed and one already saved: only the look is changing.
  if (!typed && storedKey()) {
    saveConfig({ display });
    applyDisplay(display);
    return { ok: true, checked: false };
  }
  const r = await checkKey(typed, { model: cfg.model });
  if (!r.ok) return r;
  const canEncrypt = safeStorage.isEncryptionAvailable();
  saveConfig(canEncrypt
    ? { geminiApiKeyEnc: safeStorage.encryptString(r.key).toString('base64'), geminiApiKey: '', display }
    : { geminiApiKey: r.key, display });
  cfg.geminiApiKey = r.key;
  applyDisplay(display);
  restartWatcher();
  // The key itself does not go back to the page.
  return { ok: true, checked: true, sample: r.sample, en: r.en };
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.stop();
});

app.on('window-all-closed', () => app.quit());
ipcMain.on('quit', () => app.quit());
