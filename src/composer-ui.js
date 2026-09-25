const $ = id => document.getElementById(id);
let busy = false;
function opened(state) {
  if (!busy) { $('language').value = state.language; $('style').value = state.style; }
  $('input').focus();
}
window.composer.onOpen(opened);
window.composer.state().then(opened);
$('input').addEventListener('input', () => { $('count').textContent = $('input').value.length + ' / 200'; $('copy').disabled = true; });
for (const id of ['language','style']) $(id).addEventListener('change', () => { $('copy').disabled = true; });
async function translate() {
  if (busy) return;
  busy = true; $('translate').disabled = true; $('copy').disabled = true;
  $('status').textContent = '正在翻译…'; $('output').value = '';
  for (const id of ['input','language','style']) $(id).disabled = true;
  try {
    const r = await window.composer.translate({ text: $('input').value, language: $('language').value, style: $('style').value });
    $('status').textContent = r.ok ? '译文已就绪。确认后复制，回到游戏粘贴。' : r.why;
    if (r.ok) { $('output').value = r.out; $('copy').disabled = false; }
  } catch { $('status').textContent = '翻译器连接失败，请重新打开窗口。'; }
  finally { busy = false; $('translate').disabled = false; for (const id of ['input','language','style']) $(id).disabled = false; }
}
$('translate').addEventListener('click', translate);
$('copy').addEventListener('click', async () => { if (await window.composer.copy()) $('status').textContent = '译文已复制。回游戏打开聊天框，按 Ctrl+V。'; });
$('restore').addEventListener('click', async () => { $('status').textContent = await window.composer.restore() ? '之前的文字剪贴板已恢复。' : '无需恢复，或剪贴板已被其他操作更新。'; });
document.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); translate(); }
  if (e.key === 'Escape') window.composer.hide();
});
