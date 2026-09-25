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

let game = 'dota';
const TARGET = $('targetLanguage');

function fill(s) {
  game = s.game || 'dota';
  TARGET.textContent = '';
  for (const [id, label] of s.languages) {
    if (game === 'war3' && !['en', 'ru'].includes(id)) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    TARGET.appendChild(opt);
  }
  TARGET.value = game === 'war3' && !['en', 'ru'].includes(s.targetLanguage) ? 'en' : s.targetLanguage || 'en';
  for (const id of ['showOriginal', 'showHeroes', 'autoUpdate']) $(id).checked = Boolean(s.settings[id]);
  const into = document.querySelector(`input[name=sayInto][value="${s.settings.sayInto === 'english' ? 'english' : 'theirs'}"]`);
  if (into) into.checked = true;
  $('fontSize').value = s.settings.fontSize;
  $('fontSizeOut').textContent = s.settings.fontSize + 'px';
  $('keyState').textContent = game === 'war3' ? (s.hasKey ? 'Warcraft III: own Gemini key saved. Incoming translation unavailable.' : 'Warcraft III requires your Gemini key. Hosted translation is disabled.') : s.hasKey ? 'A Gemini key is already saved on this PC.' : 'English display can use the original hosted translator. Other display languages need your own Gemini API key.';
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
  document.title = (s.game === 'war3' ? 'Warcraft Chat Translator ' : 'Dota Translator ') + s.version;
  if (s.game === 'war3') {
    document.querySelector('.brand span').textContent = 'Warcraft Chat Translator';
    document.querySelector('h1').textContent = 'Warcraft III chat translation';
    document.querySelector('.brand img').hidden = true;
    $('key').placeholder = 'Required: your Gemini API key';
    $('key').style.width = '100%';
    const languageBlock = TARGET.closest('.sayblock');
    languageBlock.querySelector('h3').textContent = 'Default outgoing language (F6)';
    languageBlock.querySelector('.hint').textContent = 'F7 always uses English; F8 always uses Russian. Incoming translation is not available.';
    document.querySelector('input[name=display]').closest('.mode').style.display = 'none';
    const outgoingBlock = document.querySelector('input[name=sayInto]').closest('.sayblock');
    outgoingBlock.querySelector('h3').textContent = 'Translate directly in the Warcraft chat box';
    outgoingBlock.querySelector('.mode').style.display = 'none';
    outgoingBlock.querySelector('.hint').firstChild.textContent = 'Type your message in game, then press F7 (English) or F8 (Russian). Hold Shift for savage. Release all keys and wait for automatic sending. No separate input window is needed.';
    $('more').style.display = 'none';
    document.querySelector('.trust').textContent = 'Your messages go directly to Gemini using your own key. This prototype translates outgoing chat only. Automatic updates are disabled.';
    const subtitle = document.querySelector('.sub');
    if (subtitle) subtitle.textContent = 'Outgoing chat: F7 English, F8 Russian. Hold Shift for savage. Your own Gemini API key is required.';
  }
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
    say('ok', game === 'war3' ? '<b>Saved.</b> Warcraft III outgoing prototype is ready. Incoming translation is unavailable.' : '<b>Saved.</b> Incoming Dota chat will use your selected display language. You can close this window; the translator keeps running in the tray.');
  } else {
    say('bad', '<b>Not saved.</b> ' + esc(r.why));
  }
});
