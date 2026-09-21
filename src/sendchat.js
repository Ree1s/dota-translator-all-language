// The helper that presses the keys (sendchat.ps1), kept running so that it
// is ready the moment the player's key is: it waits, blocked on its stdin,
// for one word at a time - `copy` or `send` - and answers with one line.
// It ends when the app does (the pipe closes). One that died is started
// again the next time it is needed.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POWERSHELL } from './memsource.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SEND_SCRIPT = path.join(HERE, 'sendchat.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

const NL = String.fromCharCode(10);

export function createKeySender({ spawnImpl = spawn, script = SEND_SCRIPT, timeoutMs = 4000 } = {}) {
  let child = null, buffer = '', waiting = null, stopped = false;

  const settle = (r) => { if (!waiting) return; const w = waiting; waiting = null; clearTimeout(w.timer); w.resolve(r); };

  function onLine(line) {
    if (line === 'copied' || line === 'sent') settle({ ok: true });
    else if (line.startsWith('NOT DONE: ')) settle({ ok: false, why: line.slice(10) });
  }

  function start() {
    if (child || stopped) return;
    buffer = '';
    try {
      const c = spawnImpl(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      child = c;
      c.stdout.on('data', (d) => {
        buffer += String(d);
        let at;
        while ((at = buffer.indexOf(NL)) >= 0) { onLine(buffer.slice(0, at).trim()); buffer = buffer.slice(at + 1); }
      });
      const gone = () => { if (child === c) child = null; settle({ ok: false, why: 'the helper stopped' }); };
      c.on('error', gone);
      c.on('exit', gone);
      c.stdin.on('error', () => { /* it went while being written to: `exit` says so */ });
    } catch { child = null; }
  }

  /** word: 'copy' | 'send'. Answers { ok, why } and never throws. One at a time. */
  function ask(word) {
    if (word !== 'copy' && word !== 'send') return Promise.resolve({ ok: false, why: 'not a command' });
    if (waiting) return Promise.resolve({ ok: false, why: 'busy' });
    start();
    if (!child) return Promise.resolve({ ok: false, why: 'the helper did not start' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle({ ok: false, why: 'the helper took too long' }), timeoutMs);
      waiting = { resolve, timer };
      try { child.stdin.write(word + NL); } catch { settle({ ok: false, why: 'the helper stopped' }); }
    });
  }

  return {
    warm: start,
    copy: () => ask('copy'),
    send: () => ask('send'),
    stop() { stopped = true; if (child) { try { child.stdin.end(); } catch { /* gone */ } child = null; } },
  };
}

/**
 * The whole act, with everything it touches handed in, so it can be tested
 * with no game, no clipboard and no model:
 * copy what is in the chat field -> translate -> put it back and send.
 * The player's clipboard is theirs and is put back whatever happens.
 */
export async function sayTranslated({ keys, clipboard, translate, into = '', explain = (m) => m, note = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const before = clipboard.readText();
  const restore = () => clipboard.writeText(before);
  // Emptied first: an empty clipboard afterwards means nothing was copied -
  // the chat was not open, or had nothing in it.
  clipboard.writeText('');
  const copied = await keys.copy();
  const typed = copied.ok ? String(clipboard.readText() || '').trim() : '';
  if (!typed) { restore(); return { said: false, why: copied.ok ? 'nothing typed' : copied.why }; }
  const ARROW = String.fromCharCode(0x2192), DOTS = String.fromCharCode(0x2026);
  const gone = () => note({ kind: 'note', text: '' });
  note({ kind: 'note', text: typed, more: ARROW + ' ' + (into || 'translating') + DOTS, holdMs: 12000 });
  let out;
  try { out = (await translate(typed)).out; } catch (err) {
    restore();
    gone();
    const why = String((err && err.message) || err);
    // In words when it is Google being slow (`explain` knows): the player
    // needs to hear that it is not them, and that nothing was sent.
    const said = explain(why);
    note({ kind: 'error', text: (said === why ? 'Not translated (' + why + ').' : said.split(' Lines are shown')[0] + ' Not translated.') + ' Your line is still in the chat - Enter sends it as it is.' });
    return { said: false, why };
  }
  clipboard.writeText(out);
  const sent = await keys.send();
  if (!sent.ok) {
    // Left on the clipboard on purpose: the player can still paste it.
    note({ kind: 'note', text: out, more: '- copied: Ctrl+V pastes it' });
    return { said: false, why: sent.why, out };
  }
  gone();
  // The game reads the clipboard when it is given Ctrl+V, not after.
  await wait(400);
  if (clipboard.readText() === out) restore();
  return { said: true, typed, out };
}
