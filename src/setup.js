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

const TARGET = $('targetLanguage');

function fill(s) {
  TARGET.textContent = '';
  for (const [id, label] of s.languages) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    TARGET.appendChild(opt);
  }
  TARGET.value = s.targetLanguage || 'en';
  for (const id of ['showOriginal', 'showHeroes', 'autoUpdate']) $(id).checked = Boolean(s.settings[id]);
  const into = document.querySelector(`input[name=sayInto][value="${s.settings.sayInto === 'english' ? 'english' : 'theirs'}"]`);
  if (into) into.checked = true;
  $('fontSize').value = s.settings.fontSize;
  $('fontSizeOut').textContent = s.settings.fontSize + 'px';
  $('keyState').textContent = s.hasKey ? 'A Gemini key is already saved on this PC.' : 'English display can use the original hosted translator. Other display languages need your own Gemini API key.';
}

const settingsNow = () => ({
  targetLanguage: TARGET.value,
  sourceLanguages: ['auto'],
  showOriginal: $('showOriginal').checked,
  showHeroes: $('showHeroes').checked,
  autoUpdate: $('autoUpdate').checked,
  fontSize: Number($('fontSize').value),
  sayInto: document.querySelector('input[name=sayInto]:checked').value,
});
// Applied at once - this one does not wait for Save.
for (const r of document.querySelectorAll('input[name=sayInto]')) {
  r.addEventListener('change', async () => {
    const now = await window.setup.sayInto(r.value);
    $('sayNow').textContent = now.sayInto === 'english' ? 'Saved: your message → English.' : 'Saved: your message → teammates\' detected language.';
    window.setup.fit();
  });
}
$('fontSize').addEventListener('input', () => { $('fontSizeOut').textContent = $('fontSize').value + 'px'; });
$('more').addEventListener('toggle', () => window.setup.fit());
$('folder').addEventListener('click', () => window.setup.folder());

// The version line: a dot and a sentence. Green = this is the latest.
function showUpdate(u) {
  const v = u.version;
  const map = {
    source: ['', 'Version ' + v + ' - run from source, no updates'],
    off: ['', 'Version ' + v + ' - automatic updates are off'],
    checking: ['wait', 'Version ' + v + ' - checking for a newer one...'],
    latest: ['ok', 'Version ' + v + ' - up to date'],
    downloading: ['wait', 'Version ' + v + ' - downloading ' + u.latest + (u.percent ? ' (' + u.percent + '%)' : '') + '...'],
    ready: ['wait', 'Version ' + v + ' - ' + u.latest + ' is ready and installs when you quit'],
    error: ['bad', 'Version ' + v + ' - could not check for updates (offline?)'],
  };
  const [dot, text] = map[u.status] || map.source;
  $('dot').className = 'dot ' + dot;
  $('updateText').textContent = text;
  $('checkNow').hidden = !(u.status === 'latest' || u.status === 'error');
  $('installNow').hidden = u.status !== 'ready';
}
$('checkNow').addEventListener('click', async () => showUpdate(await window.setup.update()));
$('installNow').addEventListener('click', () => window.setup.quitInstall());
window.setup.onUpdate(showUpdate);

window.setup.state().then((s) => {
  // Which version this is, where it can be seen: the title bar and the foot.
  document.title = 'Dota Translator ' + s.version;
  showUpdate(s.update || { status: 'source', version: s.version });
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
  const r = await window.setup.save({ display, key: $('key').value, settings: settingsNow() });
  save.disabled = false;
  if (r.ok) {
    $('key').value = '';
    say('ok', '<b>Saved.</b> Incoming Dota chat will use your selected display language. You can close this window; the translator keeps running in the tray.');
  } else {
    say('bad', '<b>Not saved.</b> ' + esc(r.why));
  }
});
