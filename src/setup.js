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

window.setup.state().then((s) => {
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
  say('busy', 'Asking Google to translate one line with your key...');
  const display = document.querySelector('input[name=display]:checked').value;
  const r = await window.setup.save({ key: key.value, display });
  save.disabled = false;
  if (r.ok) {
    key.value = '';
    $('have').style.display = 'block';
    say('ok', r.checked
      ? `<b>It works.</b> Google translated <code>${esc(r.sample)}</code> as <code>${esc(r.en)}</code>. Saved - start a match and the translations appear above the chat. You can close this window.`
      : '<b>Saved.</b> You can close this window.');
  } else {
    say('bad', '<b>Not saved.</b> ' + esc(r.why));
  }
});
