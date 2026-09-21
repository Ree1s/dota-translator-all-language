// The whole chain, reading from memory: watch Dota's chat, keep the lines
// we cannot read, translate them in batches, hand them back.
//
// The same shape as watcher.js (which reads console.log) so main.js can
// use either. The log source cannot actually see chat - Dota never writes
// it there, and DOTA_CHAT's verbosity is locked - so this is the one that
// works. watcher.js is kept because everything downstream of the source
// is shared and it is still the honest fallback if this ever breaks.

import fs from 'node:fs';
import path from 'node:path';
import { startMemorySource } from './memsource.js';
import { createPipeline } from './pipeline.js';
import { translateBatch } from './translate.js';
import { DATA_DIR } from './config.js';
import { offsetsArg } from './offsets.js';

// Why a line came up untranslated, for the player. Google's own wording is
// kept for anything not recognised here: a bad key and a spent quota
// already say what to do.
export function explainModelError(message) {
  const m = String(message == null ? '' : message);
  if (/took too long|never answered|could not reach|high demand|overloaded|unavailable|http 5\d\d/i.test(m)) {
    return 'Google\'s translator is not answering right now (busy or down). Lines are shown as they were said until it is back - nothing to do.';
  }
  return m;
}

export function startWatchingMemory(cfg, { onResult, onPending = () => {}, onStatus = () => {}, onLayout = () => {}, onSeen = () => {}, onFocus = () => {}, onGamePath = () => {}, translate, startSource = startMemorySource } = {}) {
  // hedge: whether a slow call may be raced by a second one. The pipeline
  // says no once the minute's calls are half spent.
  const doTranslate = translate || ((batch, { hedge = true } = {}) => translateBatch(batch, {
    apiKey: cfg.geminiApiKey,
    model: cfg.model,
    attempts: hedge ? undefined : 1,
  }));

  // What has been translated already. Chat repeats itself - "gg", the
  // same insult, the chat wheel in Russian - and a repeat answered from
  // here is on screen at once and costs no call.
  const cache = new Map();
  const remember = (row) => {
    if (!row.translated) return;
    cache.set(row.text, row.en);
    if (cache.size > 500) cache.delete(cache.keys().next().value);
  };
  let nextId = 1;
  let lastModelError = { text: '', at: 0 };

  const pipe = createPipeline({
    translate: doTranslate,
    batchMs: cfg.batchMs,
    callsPerMinute: cfg.callsPerMinute,
    onResult: (row) => { remember(row); onResult(row); },
    // Said in words, and at most once a minute: when Google is down EVERY
    // line fails, and a line of error under each of them is a second wall
    // of text over the game. SEEN 2026-09-21: an hour of "high demand" and
    // hung calls on every Flash model, the key and the app both fine.
    onError: (err) => {
      const text = explainModelError(String((err && err.message) || err));
      const now = Date.now();
      if (text === lastModelError.text && now - lastModelError.at < 60000) return;
      lastModelError = { text, at: now };
      onStatus({ kind: 'error', text });
    },
  });

  const learnPath = path.join(DATA_DIR, 'learn.log');

  const source = startSource({
    scripts: cfg.scripts,
    intervalMs: cfg.scanIntervalMs,
    fullRescanMs: cfg.fullRescanMs,
    onStatus,
    onMessage: (msg) => {
      // Every line gets an id and is announced AT ONCE, untranslated: the
      // chat box shows it as said and fills the English in when it comes.
      // The reader finds a line in ~0.2s and the model takes ~1s, so this
      // is the difference between a box that keeps up with the game and
      // one that is always a second behind it.
      const item = { ...msg, id: nextId++ };
      const known = cache.get(msg.text);
      if (known) { onResult({ ...item, en: known, translated: true, cached: true }); return; }
      onPending(item);
      pipe.push(item);
    },
    windowMb: cfg.scanWindowMb,
    wideEvery: cfg.scanWideEvery,
    wideCapMb: cfg.scanWideCapMb,
    panel: cfg.chatPanel,
    panelIntervalMs: cfg.panelIntervalMs,
    offsets: cfg.offsets ? offsetsArg(cfg.offsets.panel) : undefined,
    onLayout,
    onSeen,
    onFocus,
    onGamePath,
    onFind: (find) => onStatus({ kind: 'find', text: '', find }),
    onPlacement: (p) => {
      // The measurement that says whether scan windows are any good and
      // how big they must be. Only a live game can produce it, so it is
      // written down whenever somebody has asked to learn.
      if (!cfg.learn) return;
      try {
        const distance = p.distance === null ? 'none' : p.distance;
        // Hex, because these are compared by eye against each other.
        const hex = (n) => '0x' + Number(n).toString(16);
        const where = Number.isFinite(p.region)
          ? ` addr=${hex(p.addr)} region=${hex(p.region)} regionMb=${(p.regionSize / 1048576).toFixed(1)} alloc=${hex(p.alloc)}`
          : '';
        fs.appendFileSync(learnPath,
          `placement ${new Date().toISOString()} mode=${p.mode} inWindow=${p.inWindow ? 1 : 0} distance=${distance} channel=${p.channel}${where}\n`);
      } catch { /* best effort */ }
    },
    onStat: (stat) => onStatus({ kind: 'stat', text: '', stat }),
    onUnknownTag: (tag) => {
      // A channel the code does not know is the one failure that would
      // otherwise be invisible: those lines would simply never be
      // translated. Say it, and write it down.
      onStatus({ kind: 'error', text: `Unknown chat channel "[${tag}]" - not translated.` });
      try {
        fs.appendFileSync(learnPath, `unknown channel tag: ${tag}\n`);
      } catch { /* best effort */ }
    },
  });

  return {
    stop() { source.stop(); pipe.stop(); },
    // What a line MEANS, when the app already knows: the player's own line,
    // sent translated a moment ago, comes back out of the chat like anybody
    // else's - and its English is what they typed, not what a model thinks
    // the translation of their translation is. SEEN: "my name is kristjan"
    // went out as Cyrillic and came back on the overlay as "my name is
    // christian", one call later. No call, and exact.
    know(text, en) {
      const t = String(text || '').trim(), e = String(en || '').trim();
      if (!t || !e) return;
      cache.delete(t); cache.set(t, e);
      if (cache.size > 500) cache.delete(cache.keys().next().value);
    },
  };
}
