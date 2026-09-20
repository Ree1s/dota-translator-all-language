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

export function startWatchingMemory(cfg, { onResult, onStatus = () => {}, translate } = {}) {
  const doTranslate = translate || ((batch) => translateBatch(batch, {
    apiKey: cfg.geminiApiKey,
    model: cfg.model,
  }));

  const pipe = createPipeline({
    translate: doTranslate,
    batchMs: cfg.batchMs,
    onResult,
    onError: (err) => onStatus({ kind: 'error', text: String((err && err.message) || err) }),
  });

  const learnPath = path.join(ROOT, 'learn.log');

  const source = startMemorySource({
    scripts: cfg.scripts,
    intervalMs: cfg.scanIntervalMs,
    fullRescanMs: cfg.fullRescanMs,
    onStatus,
    onMessage: (msg) => pipe.push(msg),
    windowMb: cfg.scanWindowMb,
    wideEvery: cfg.scanWideEvery,
    wideCapMb: cfg.scanWideCapMb,
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
