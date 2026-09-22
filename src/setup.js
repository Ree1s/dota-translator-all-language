// The settings window's page. Since v0.5.0 there is no key in it: the
// translating runs through the project's own server.

const $ = (id) => document.getElementById(id);
const result = $('result'), save = $('save');

function say(kind, html) {
  result.className = kind;
  result.innerHTML = html;
  window.setup.fit();          // the window grows with what it has to say
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LANGS = document.getElementById('langs');
function fill(s) {
  LANGS.textContent = '';
  for (const [id, label] of s.languages) {
    const l = document.createElement('label'); l.className = 'check';
    const box = document.createElement('input'); box.type = 'checkbox'; box.value = id; box.checked = s.settings.scripts.includes(id);
    l.append(box, document.createTextNode(label)); LANGS.appendChild(l);
  }
  for (const id of ['showOriginal', 'showHeroes', 'autoUpdate']) $(id).checked = Boolean(s.settings[id]);
  const into = document.querySelector(`input[name=sayInto][value="${s.settings.sayInto === 'english' ? 'english' : 'theirs'}"]`);
  if (into) into.checked = true;
  $('fontSize').value = s.settings.fontSize; $('fontSizeOut').textContent = s.settings.fontSize + 'px';
}
const settingsNow = () => ({
  scripts: [...LANGS.querySelectorAll('input:checked')].map((b) => b.value),
  showOriginal: $('showOriginal').checked, showHeroes: $('showHeroes').checked, autoUpdate: $('autoUpdate').checked,
  fontSize: Number($('fontSize').value),
  sayInto: document.querySelector('input[name=sayInto]:checked').value,
});
// Applied at once - this one does not wait for Save.
for (const r of document.querySelectorAll('input[name=sayInto]')) {
  r.addEventListener('change', async () => {
    const now = await window.setup.sayInto(r.value);
    $('sayNow').textContent = now.sayInto === 'english' ? 'Saved: Russian → English.' : 'Saved: English → Russian.';
    window.setup.fit();
  });
}
$('fontSize').addEventListener('input', () => { $('fontSizeOut').textContent = $('fontSize').value + 'px'; });
$('more').addEventListener('toggle', () => window.setup.fit());
$('folder').addEventListener('click', () => window.setup.folder());

window.setup.state().then((s) => {
  // Which version this is, where it can be seen: the title bar and the foot.
  document.title = 'Dota Translator ' + s.version;
  $('version').textContent = 'Version ' + s.version;
  fill(s);
  const mode = document.querySelector(`input[name=display][value="${s.display === 'box' ? 'box' : 'above'}"]`);
  if (mode) mode.checked = true;
  window.setup.fit();
});

$('close').addEventListener('click', () => window.setup.close());

save.addEventListener('click', async () => {
  save.disabled = true;
  say('busy', 'Saving...');
  const display = document.querySelector('input[name=display]:checked').value;
  const r = await window.setup.save({ display, settings: settingsNow() });
  save.disabled = false;
  if (r.ok) {
    say('ok', '<b>Saved.</b> You can close this window: Dota Translator keeps running as the small icon by the clock (behind the ^ arrow), and clicking it brings this window back.');
  } else {
    say('bad', '<b>Not saved.</b> ' + esc(r.why));
  }
});
