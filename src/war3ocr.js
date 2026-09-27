import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POWERSHELL } from './memsource.js';
import { MAC_HELPER, macHelperArgs } from './mac-helper.js';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'war3ocr.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
export function ocrCommand(args, platform = process.platform) {
  if (platform !== 'darwin') return { command: POWERSHELL, args: ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script, ...args] };
  const value = key => args[args.indexOf(key) + 1];
  const nativeArgs = macHelperArgs(args.includes('-SelectRegion') ? 'ocr-select' : 'ocr');
  if (args.includes('-Region')) nativeArgs.push('--region', value('-Region'));
  if (args.includes('-Language')) nativeArgs.push('--language', value('-Language'));
  return { command: MAC_HELPER, args: nativeArgs };
}
export function runOcrHelper(args, onEvent, onError = () => {}) {
  const command = ocrCommand(args);
  const child = spawn(command.command, command.args, { windowsHide: true });
  const lines = createInterface({ input: child.stdout });
  let stopped = false, errors = '';
  lines.on('line', line => { try { onEvent(JSON.parse(line)); } catch {} });
  child.stderr.on('data', b => { errors = (errors + b.toString()).slice(-4000); });
  child.on('error', err => onError(err.message));
  child.on('exit', code => { lines.close(); if (!stopped && code) onError(errors || `OCR helper exited: ${code}`); });
  return { stop() { stopped = true; child.kill(); lines.close(); } };
}

// Two consecutive matching frames reduce flicker. Only player-prefixed lines
// qualify; map notices and the unsubmitted input field are not chat messages.
export function createOcrTracker({ ttl = 60000 } = {}) {
  let previous = new Set();
  const seen = new Map();
  return (lines, now = Date.now()) => {
    const current = new Set(), rows = [];
    for (const raw of lines) {
      const line = String(raw).replace(/\s+/g, ' ').trim();
      const match = /^(?:\[[^\]]{1,20}\]\s*)?([^:：]{1,40})[:：]\s*(\S.{1,399})$/.exec(line);
      if (!match) continue;
      const [, name, text] = match;
      const key = `${name.trim()}|${text}`.toLowerCase();
      current.add(key);
      if (previous.has(key) && !seen.has(key)) rows.push({ name: name.trim(), text, firstSeen: now });
      if (previous.has(key) || seen.has(key)) seen.set(key, now);
    }
    for (const [key, time] of seen) if (now - time > ttl) seen.delete(key);
    previous = current;
    return rows;
  };
}

export function startWar3Ocr({ region, language = 'en-US', translate, preview = false, onRow, onStatus, onWindow = () => {}, log = () => {} }) {
  const track = createOcrTracker();
  let stopped = false, busy = false, sequence = 0;
  let lastFrame = '', lastPreview = '';
  const queue = [];
  async function drain() {
    if (busy || stopped) return;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const row = queue.shift();
        if (Date.now() - row.firstSeen > 15000) { log({ kind: 'expired', id: row.id }); continue; }
        const start = Date.now();
        try {
          const result = preview ? { out: row.text } : await translate(row.text);
          if (!stopped) onRow({ ...row, en: result.out, translated: !preview });
          log({ kind: 'translated', id: row.id, translationMs: Date.now() - start, pipelineMs: Date.now() - row.firstSeen });
        } catch (e) { if (!stopped) onStatus(`OCR translation: ${e.message}`); }
      }
    } finally { busy = false; }
  }
  const helper = runOcrHelper(['-ParentId', String(process.pid), '-Region', region.join(','), '-Language', language], event => {
    if (stopped) return;
    if (event.kind !== 'frame') { log(event); if (event.kind === 'error') onStatus(event.text); return; }
    if (event.window) onWindow(event.window);
    const frame = JSON.stringify(event.lines || []);
    if (frame !== lastFrame) {
      log({ kind: 'raw-frame', lines: event.lines || [], ocrMs: event.ocrMs });
      lastFrame = frame;
    }
    if (preview) {
      const text = (event.lines || []).join(' ').trim();
      if (text && text !== lastPreview) {
        onRow({ id: Date.now(), name: 'OCR preview', text, en: text, translated: false });
        lastPreview = text;
      }
      if (!text) lastPreview = '';
      return;
    }
    for (const row of track(event.lines || [])) {
      row.id = Date.now() * 100 + (++sequence % 100);
      log({ kind: 'recognized', ...row, ocrMs: event.ocrMs });
      if (queue.length < 8) queue.push(row); else log({ kind: 'queue-full', id: row.id });
    }
    void drain();
  }, onStatus);
  return { stop() { stopped = true; queue.length = 0; helper.stop(); } };
}
