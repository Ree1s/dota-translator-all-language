// Draws the lines and lets them go. Nothing here reaches out: every
// message arrives over the preload bridge.

const list = document.getElementById('list');
let cfg = { holdSeconds: 14, maxLines: 6, showOriginal: true, fontSize: 16, opacity: 0.92 };

function trim() {
  while (list.children.length > cfg.maxLines) list.removeChild(list.firstChild);
}

function fade(el, afterMs) {
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 700);
  }, afterMs);
}

function addLine(row) {
  const el = document.createElement('div');
  el.className = 'row' + (row.translated ? '' : ' plain');

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = row.name + ':';
  el.appendChild(name);

  const text = document.createElement('span');
  text.textContent = row.en;
  el.appendChild(text);

  if (cfg.showOriginal && row.translated && row.text !== row.en) {
    const orig = document.createElement('span');
    orig.className = 'orig';
    orig.textContent = row.text;
    el.appendChild(orig);
  }

  list.appendChild(el);
  trim();
  fade(el, cfg.holdSeconds * 1000);
}

function addStatus(s) {
  if (s.kind === 'ready') return;          // nothing to say when it works
  if (!s.text) return;                     // a stat or a find: numbers, not words
  const el = document.createElement('div');
  el.className = 'status';
  el.textContent = s.text;
  list.appendChild(el);
  trim();
  fade(el, 8000);
}

window.dt.onConfig((next) => {
  cfg = { ...cfg, ...next };
  document.documentElement.style.setProperty('--size', cfg.fontSize + 'px');
  document.body.style.opacity = String(cfg.opacity);
});
window.dt.onLine(addLine);
window.dt.onStatus(addStatus);
