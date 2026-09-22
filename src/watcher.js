// The whole chain in one place: find the log, follow it, keep the chat
// lines we cannot read, translate them in batches, hand them back.

import fs from 'node:fs';
import path from 'node:path';
import { LogTail, chatToTranslate, parseChatLine, needsTranslation, findLogPath } from './chatlog.js';
import { createPipeline } from './pipeline.js';
import { translateBatch } from './translate.js';
import { DATA_DIR } from './config.js';

export function resolveLogPath(cfg) {
  if (cfg.logPath) return cfg.logPath;
  return findLogPath();
}

export function startWatching(cfg, { onResult, onStatus = () => {}, translate } = {}) {
  const file = resolveLogPath(cfg);
  if (!file) {
    onStatus({ kind: 'error', text: 'Dota 2 console.log not found. Set logPath in config.json.' });
    return { stop() {} };
  }
  if (!fs.existsSync(file)) {
    onStatus({ kind: 'waiting', text: 'Waiting for Dota to write the log. Is -condebug set?', file });
  } else {
    onStatus({ kind: 'ready', text: 'Watching chat.', file });
  }

  const doTranslate = translate || ((batch) => translateBatch(batch, {
    apiKey: cfg.geminiApiKey,
    model: cfg.model,
    targetLanguage: cfg.targetLanguage || 'English',
  }));

  const pipe = createPipeline({
    translate: doTranslate,
    batchMs: cfg.batchMs,
    onResult,
    onError: (err) => onStatus({ kind: 'error', text: String(err && err.message || err) }),
  });

  const learnPath = path.join(DATA_DIR, 'learn.log');
  const tail = new LogTail(file);
  tail.onLine = (line) => {
    const msg = chatToTranslate(line, { targetLanguage: cfg.targetLanguage || 'English', sourceLanguages: cfg.sourceLanguages || ['auto'] });
    if (msg) { pipe.push(msg); return; }
    // A line carrying a script we cannot read that the parser did NOT
    // take as chat is the one thing worth recording: it means the chat
    // format differs from what parseChatLine expects.
    if (cfg.learn && !parseChatLine(line) && needsTranslation(line, { targetLanguage: cfg.targetLanguage || 'English', sourceLanguages: cfg.sourceLanguages || ['auto'] })) {
      try { fs.appendFileSync(learnPath, line + '\n'); } catch { /* best effort */ }
    }
  };
  tail.onError = () => {};   // a log that is not there yet is normal
  tail.start();

  return { file, stop() { tail.stop(); pipe.stop(); } };
}
