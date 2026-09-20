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
