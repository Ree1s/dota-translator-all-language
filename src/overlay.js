// The translated chat box. Nothing here reaches out: every message
// arrives over the preload bridge.
//
// A line arrives TWICE. First as `pending`, the moment it is read out of
// the game - shown as it was said, dimmed - and then as `line`, carrying
// the same id and the English, which replaces the text where it stands.
// So the box keeps pace with the game's own chat, and the translation
// lands in a row the eye is already on. A line with no pending row (a
// cached translation, or the old log source) is simply added.

const box = document.getElementById('box');
let cfg = { holdSeconds: 14, maxLines: 6, showOriginal: true, fontSize: 16, opacity: 0.92, position: 'top-left' };

// Dota's ten player colours, by slot - the same ones the game's own chat
// uses, so a name here is recognisably the name there.
const SLOT_COLOURS = ['#3375FF', '#66FFBF', '#BF00BF', '#F3F00B', '#FF6B00', '#FE86C2', '#A1B447', '#65D9F7', '#008321', '#A46900'];
const TAGS = { team: '[Allies]', all: '[All]', spectator: '[Spectators]', coach: '[Coaches]' };

// The game draws these on its own lit panel; on a dark box the blue, the
// purple and the dark green are hard to read. Dark ones are lifted
// towards white until they are not, and stay recognisably themselves.
function readable(hex) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let n = 0; n < 6 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 140; n++) {
    [r, g, b] = [r, g, b].map((v) => Math.round(v + (255 - v) * 0.2));
  }
  return `rgb(${r}, ${g}, ${b})`;
}

const rows = new Map();          // id -> element

function trim() {
  while (box.children.length > cfg.maxLines) {
    const first = box.firstChild;
    if (first.dataset && first.dataset.id) rows.delete(Number(first.dataset.id));
    box.removeChild(first);
  }
}

function fade(el, afterMs) {
  clearTimeout(el._fade);
  el._fade = setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { if (el.dataset.id) rows.delete(Number(el.dataset.id)); el.remove(); }, 600);
  }, afterMs);
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function build(row, state) {
  const el = document.createElement('div');
  el.className = 'row ' + state + (row.channel === 'team' ? ' team' : '');
  if (row.id) el.dataset.id = String(row.id);
  if (TAGS[row.channel]) el.appendChild(span('tag', TAGS[row.channel]));
  const name = span('name', row.name + ':');
  name.style.color = readable(SLOT_COLOURS[row.slot] || '#7fd4ff');
  el.appendChild(name);
  el.appendChild(span('say', state === 'pending' ? row.text : row.en));
  // "english (as it was said)", on one line, the way it is wanted in the
  // game's own chat too. Nothing in brackets when the line was English
  // already: that would only say the same thing twice.
  if (state === 'done' && cfg.showOriginal && row.translated && row.text.trim().toLowerCase() !== row.en.trim().toLowerCase()) {
    el.appendChild(span('orig', ' (' + row.text + ')'));
  }
  return el;
}

function addPending(row) {
  const el = build(row, 'pending');
  rows.set(row.id, el);
  box.appendChild(el);
  trim();
  fade(el, cfg.holdSeconds * 1000);
}

function addLine(row) {
  const el = build(row, row.translated ? 'done' : 'plain');
  const was = row.id ? rows.get(row.id) : null;
  if (was && was.isConnected) {
    clearTimeout(was._fade);
    box.replaceChild(el, was);
  } else {
    box.appendChild(el);
  }
  if (row.id) rows.set(row.id, el);
  trim();
  // The hold starts again when the English arrives: that is when there
  // is something to read.
  fade(el, cfg.holdSeconds * 1000);
}

function addStatus(s) {
  if (s.kind === 'ready') return;          // nothing to say when it works
  if (!s.text) return;                     // a stat or a find: numbers, not words
  const el = document.createElement('div');
  el.className = 'status';
  el.textContent = s.text;
  box.appendChild(el);
  trim();
  fade(el, 8000);
}

window.dt.onConfig((next) => {
  cfg = { ...cfg, ...next };
  document.documentElement.style.setProperty('--size', cfg.fontSize + 'px');
  document.body.style.opacity = String(cfg.opacity);
  // Anchored to the bottom, the box grows UPWARDS, as a chat does.
  document.body.classList.toggle('bottom', String(cfg.position).startsWith('bottom') || cfg.position === 'chat');
});
window.dt.onPending(addPending);
window.dt.onLine(addLine);
window.dt.onStatus(addStatus);
