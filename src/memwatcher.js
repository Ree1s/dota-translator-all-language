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
import { ROOT } from './config.js';

export function startWatchingMemory(cfg, { onResult, onPending = () => {}, onStatus = () => {}, onLayout = () => {}, onSeen = () => {}, onFocus = () => {}, translate, startSource = startMemorySource } = {}) {
  const doTranslate = translate || ((batch) => translateBatch(batch, {
    apiKey: cfg.geminiApiKey,
    model: cfg.model,
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

  const pipe = createPipeline({
    translate: doTranslate,
    batchMs: cfg.batchMs,
    onResult: (row) => { remember(row); onResult(row); },
    onError: (err) => onStatus({ kind: 'error', text: String((err && err.message) || err) }),
  });

  const learnPath = path.join(ROOT, 'learn.log');

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
    onLayout,
    onSeen,
    onFocus,
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
  };
}
