// The say window. Nothing here reaches out: the line goes over the preload
// bridge, and the app translates it, puts it on the clipboard and closes
// this window. Only a failure is shown here, because only then is there
// anything left to do here.

const input = document.getElementById('text');
const hint = document.getElementById('hint');
const to = document.getElementById('to');

window.say.state().then((s) => { if (s && s.language) to.textContent = 'EN → ' + s.language; });

input.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { window.say.close(); return; }
  if (e.key !== 'Enter' || input.disabled) return;
  const text = input.value.trim();
  if (!text) { window.say.close(); return; }
  input.disabled = true;
  hint.className = '';
  hint.textContent = 'Translating...';
  const r = await window.say.send(text);
  if (r && r.ok) return;                       // copied; the app closes the window
  input.disabled = false;
  input.focus();
  hint.className = 'bad';
  hint.textContent = (r && r.error) || 'That did not work. Enter tries again, Esc closes.';
});

input.focus();
