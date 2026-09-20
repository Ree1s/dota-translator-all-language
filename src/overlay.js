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
  // The game tags team chat and leaves all chat bare; beside the game's
  // own lines, so do we. In a panel of its own the tag is worth having.
  const bareLook = document.body.classList.contains('bare');
  if (TAGS[row.channel] && !(bareLook && row.channel === 'all')) el.appendChild(span('tag', TAGS[row.channel]));
  const name = span('name', row.name + ':');
  // Beside the game's own chat, the game's own colours exactly: outlined
  // text carries the dark blue as well there as it does in Dota. Lifting
  // them is for the dark panel, where they sink.
  const colour = SLOT_COLOURS[row.slot] || '#7fd4ff';
  name.style.color = document.body.classList.contains('bare') ? colour : readable(colour);
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

// ---- COVER mode -----------------------------------------------------
// The game says where its chat lines are (`layout`: the stack of rows,
// newest first, each with the address of its text) and which line lives
// at which address (`seen`). A translated line is drawn as a strip over
// its own row - after the hero portrait, which is left showing - and
// stays for holdSeconds, which is longer than the game keeps its own
// line up (MEASURED: about 5 seconds), so the English outlasts the
// Russian it covers. A faded line keeps its slot in the game, so the
// strip stays where it was.
const cover = document.getElementById('cover');
const keyOf = (r) => r.channel + '|' + r.name + '|' + r.text;
const addrKey = new Map();       // address of a line's text -> key
const english = new Map();       // key -> { row, until }
let layout = null;
const firstSeen = new Map();     // key -> when the line first appeared in the game
// How long the game keeps its own line up. MEASURED with timed
// screenshots: there at 4s, gone by 7s - and then, watching the user's own
// chat, STILL THERE at 6s twice, with the bare English printed on top of
// it. So 8.5s: a strip that lingers a second too long costs nothing, and
// one that leaves early is unreadable. Until then the strip has to hide
// the line; after that there is nothing under the English but the game.
const GAME_SHOWS_MS = 8500;
// In the 1080-high units the game lays out in: where a line's text starts
// (after the 7 of padding and the portrait), MEASURED on one screen.
const TEXT_LEFT = 49, PAD = 4, FONT = 18;

function covering() { return cfg.display === 'cover' && layout; }

function renderCover() {
  cover.textContent = '';
  if (!covering()) return;
  const s = layout.scale, now = Date.now();
  let bottom = 0, next = Infinity;
  for (const r of layout.rows) {
    const t = english.get(addrKey.get(r.addr));
    if (t && t.until > now && r.height > 0) {
      next = Math.min(next, t.until);
      const bareAt = (firstSeen.get(addrKey.get(r.addr)) || 0) + GAME_SHOWS_MS;
      if (bareAt > now) next = Math.min(next, bareAt);
      const el = document.createElement('div');
      el.className = 'strip' + (bareAt <= now ? ' bare' : '') + (t.row.channel === 'team' ? ' team' : '') + (r.height > 40 * s ? ' wrap' : '');
      el.style.left = (TEXT_LEFT * s) + 'px';
      el.style.bottom = bottom + 'px';
      el.style.height = r.height + 'px';
      el.style.minWidth = Math.max(0, r.width - (TEXT_LEFT - 7) * s) + 'px';
      el.style.maxWidth = 'calc(100% - ' + (TEXT_LEFT * s) + 'px)';
      el.style.paddingLeft = (PAD * s) + 'px';
      el.style.fontSize = (FONT * s) + 'px';
      if (t.row.channel === 'team') el.appendChild(span('tag', TAGS.team));
      const name = span('name', t.row.name + ':');
      name.style.color = readable(SLOT_COLOURS[t.row.slot] || '#7fd4ff');
      el.appendChild(name);
      el.appendChild(span('say', t.row.en));
      if (cfg.showOriginal && t.row.text.trim().toLowerCase() !== t.row.en.trim().toLowerCase()) el.appendChild(span('orig', '(' + t.row.text + ')'));
      cover.appendChild(el);
    }
    bottom += r.height;
  }
  clearTimeout(renderCover.timer);
  if (next !== Infinity) renderCover.timer = setTimeout(renderCover, next - now + 20);
}

/// True when the line has a row in the game's chat to be laid over.
function coverLine(row) {
  if (!covering() || !row.translated) return false;
  const k = keyOf(row);
  if (![...addrKey.values()].includes(k)) return false;
  english.set(k, { row, until: Date.now() + cfg.holdSeconds * 1000 });
  if (english.size > 100) english.delete(english.keys().next().value);
  renderCover();
  return true;
}

function addPending(row) {
  // Over the game's own chat there is nothing to show yet: the line is
  // already on the screen, in Russian, exactly where the English will go.
  if (covering()) return;
  const el = build(row, 'pending');
  rows.set(row.id, el);
  box.appendChild(el);
  trim();
  fade(el, cfg.holdSeconds * 1000);
}

function addLine(row) {
  if (coverLine(row)) return;
  // A line that could not be translated is already on the screen as it
  // was said; over the game's chat there is nothing to add to that.
  if (covering() && !row.translated) return;
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
window.dt.onLayout((l) => {
  layout = l;
  if (cfg.display === 'above') {
    // Sized and indented as the game's lines are, and growing upwards
    // from just above them, so it reads as the same chat carrying on.
    document.body.classList.add('bare', 'bottom');
    document.documentElement.style.setProperty('--size', (FONT * l.scale) + 'px');
    // The game's own row pitch, which it reports in SCREEN pixels (34 at
    // scale 1.33) - scaling it again spread the lines a third too far apart.
    const pitch = Math.min(...l.rows.map((r) => r.height).filter((h) => h > 0));
    if (Number.isFinite(pitch)) box.style.lineHeight = pitch + 'px';
    box.style.paddingLeft = (TEXT_LEFT * l.scale) + 'px';
    return;
  }
  renderCover();
});
window.dt.onSeen((s) => {
  addrKey.set(s.addr, keyOf(s));
  if (!firstSeen.has(keyOf(s))) firstSeen.set(keyOf(s), Date.now());
  if (firstSeen.size > 200) firstSeen.delete(firstSeen.keys().next().value);
  if (addrKey.size > 200) addrKey.delete(addrKey.keys().next().value);
});
window.dt.onFonts((dir) => {
  // The game's own faces, from the game's own folder. "Radiance" is already
  // first in the font stack, so until (or unless) these load it is Segoe UI.
  const css = [['regular', 400, 'normal'], ['regularitalic', 400, 'italic'], ['semibold', 600, 'normal'], ['bold', 700, 'normal'], ['bolditalic', 700, 'italic']]
    .map(([file, weight, style]) => `@font-face { font-family: "Radiance"; src: url("${dir}/radiance-${file}.otf"); font-weight: ${weight}; font-style: ${style}; }`).join(' ');
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
});
window.dt.onPending(addPending);
window.dt.onLine(addLine);
window.dt.onStatus(addStatus);
