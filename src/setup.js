// The setup window's page. It never sees a saved key: it is told only
// WHETHER one is saved, and sends a new one off to be checked.

const $ = (id) => document.getElementById(id);
const key = $('key'), result = $('result'), save = $('save');

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
  $('fontSize').value = s.settings.fontSize; $('fontSizeOut').textContent = s.settings.fontSize + 'px';
}
const settingsNow = () => ({
  scripts: [...LANGS.querySelectorAll('input:checked')].map((b) => b.value),
  showOriginal: $('showOriginal').checked, showHeroes: $('showHeroes').checked, autoUpdate: $('autoUpdate').checked,
  fontSize: Number($('fontSize').value),
});
$('fontSize').addEventListener('input', () => { $('fontSizeOut').textContent = $('fontSize').value + 'px'; });
$('more').addEventListener('toggle', () => window.setup.fit());
$('folder').addEventListener('click', () => window.setup.folder());

window.setup.state().then((s) => {
  fill(s);
  // Somebody who already has a key is here for the settings: a plain Save.
  if (s.hasKey) save.textContent = 'Save';
  if (s.hasKey) { $('have').style.display = 'block'; key.placeholder = 'Saved. Paste a new key to replace it'; }
  const mode = document.querySelector(`input[name=display][value="${s.display === 'box' ? 'box' : 'above'}"]`);
  if (mode) mode.checked = true;
  if (!s.hasKey) key.focus();
  window.setup.fit();
});

$('show').addEventListener('click', () => {
  const hidden = key.type === 'password';
  key.type = hidden ? 'text' : 'password';
  $('show').textContent = hidden ? 'Hide' : 'Show';
});
$('guide').addEventListener('click', () => window.setup.guide());
$('close').addEventListener('click', () => window.setup.close());
key.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });

save.addEventListener('click', async () => {
  save.disabled = true;
  say('busy', key.value.trim() ? 'Asking Google to translate one line with your key...' : 'Saving...');
  const display = document.querySelector('input[name=display]:checked').value;
  const r = await window.setup.save({ key: key.value, display, settings: settingsNow() });
  save.disabled = false;
  if (r.ok) {
    key.value = '';
    $('have').style.display = 'block';
    save.textContent = 'Save';
    say('ok', r.checked
      ? `<b>It works.</b> Google translated <code>${esc(r.sample)}</code> as <code>${esc(r.en)}</code>. Saved - start a match and the translations appear above the chat. You can close this window.`
      : '<b>Saved.</b> You can close this window.');
  } else {
    say('bad', '<b>Not saved.</b> ' + esc(r.why));
  }
});
