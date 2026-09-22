// Renders docs/logo.svg into every icon file the app and the site use:
//
//   npx electron tools/makeicons.mjs
//
// Electron is the only rasteriser on this machine (there is no image tool),
// so an offscreen window draws the SVG on a canvas at each size and hands
// back PNG and WebP. The .ico files are written here: an ICO may hold PNG
// entries, so it is a small header plus the PNGs.

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = fs.readFileSync(path.join(ROOT, 'docs', 'logo.svg'), 'utf8');

function ico(pngs) {
  // pngs: [{size, buf}]. Header 6 bytes, 16 per entry, then the images.
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas id=c></canvas>');
  const render = (size, type) => win.webContents.executeJavaScript(`new Promise((ok, no) => {
    const c = document.getElementById('c'); c.width = ${size}; c.height = ${size};
    const img = new Image();
    img.onload = () => { const g = c.getContext('2d'); g.clearRect(0, 0, ${size}, ${size}); g.drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL(${JSON.stringify(type)}, 0.95).split(',')[1]); };
    img.onerror = () => no(new Error('svg did not load'));
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(SVG).toString('base64'))};
  })`).then((b64) => Buffer.from(b64, 'base64'));

  const png = {};
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) png[s] = await render(s, 'image/png');
  const out = (rel, buf) => { fs.writeFileSync(path.join(ROOT, rel), buf); console.log(rel, buf.length); };
  out('build/icon.png', png[256]);
  out('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, buf: png[s] }))));
  out('docs/favicon.ico', ico([16, 32, 48].map((s) => ({ size: s, buf: png[s] }))));
  out('src/tray.png', png[64]);
  out('src/logo.webp', await render(64, 'image/webp'));
  for (const s of [64, 192, 512]) out('docs/logo-' + s + '.webp', await render(s, 'image/webp'));
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
