const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
ipcMain.handle('composer:state', () => ({ language: 'English', style: 'faithful' }));
ipcMain.handle('composer:translate', () => ({ ok: true, out: 'Creep first, then expand.' }));
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 680, height: 740, show: false, webPreferences: { preload: path.join(__dirname, 'src/composer-preload.cjs'), contextIsolation: true, sandbox: true } });
  await w.loadFile(path.join(__dirname, 'src/composer.html'));
  await w.webContents.executeJavaScript("document.getElementById('input').value = '先练级，然后开分矿'; document.getElementById('translate').click();");
  await new Promise(r => setTimeout(r, 400));
  const state = await w.webContents.executeJavaScript("({result:document.getElementById('output').value,copyDisabled:document.getElementById('copy').disabled,overflow:document.body.scrollHeight>innerHeight})");
  console.log(JSON.stringify(state));
  fs.writeFileSync('composer-preview.png', (await w.webContents.capturePage()).toPNG());
  app.exit(state.result === 'Creep first, then expand.' && !state.copyDisabled && !state.overflow ? 0 : 1);
});
