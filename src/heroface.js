// The hero portraits the GAME draws in its chat, read out of the player's
// own install. They are not the pictures on Valve's web server: the game's
// are older, 128x72, tighter on the face (the user saw it at once: "ours is
// bigger and shows a bit differently"). Like the font, they are read from
// the game's folder and never copied into this repo.
//
// They live in the game's packed archive: pak01_dir.vpk is the directory
// (a tree of extension / folder / name, each entry saying which
// pak01_NNN.vpk holds the file and where), and each picture is a compiled
// texture, `panorama/images/heroes/npc_dota_hero_<name>_png.vtex_c`. Three
// pixel formats were found among the 140-odd heroes (2026-09-21): DXT5
// holding YCoCg (most of them), an embedded PNG, and raw BGRA. Anything else
// - or anything that does not add up - gives null, and the overlay falls
// back to the web picture. Reading only; nothing here touches the running
// game, only files on disk.
import fs from 'node:fs';
import path from 'node:path';

const FOLDER = 'panorama/images/heroes';
const FMT_DXT5 = 2, FMT_PNG = 16, FMT_BGRA = 28;

// The directory: which archive, where, how long - for hero portraits only.
export function readIndex(dirFile) {
  const b = fs.readFileSync(dirFile);
  if (b.readUInt32LE(0) !== 0x55aa1234) return new Map();
  let p = b.readUInt32LE(4) === 2 ? 28 : 12;
  const str = () => { const e = b.indexOf(0, p); const s = b.toString('latin1', p, e); p = e + 1; return s; };
  const index = new Map();
  for (;;) {
    const ext = str(); if (!ext) break;
    for (;;) {
      const folder = str(); if (!folder) break;
      for (;;) {
        const name = str(); if (!name) break;
        const preload = b.readUInt16LE(p + 4), archive = b.readUInt16LE(p + 6), offset = b.readUInt32LE(p + 8), length = b.readUInt32LE(p + 12);
        p += 18 + preload;
        const m = ext === 'vtex_c' && folder === FOLDER && /^npc_dota_hero_([a-z_]+)_png$/.exec(name);
        // 0x7fff means "inside the directory file itself"; none of these are.
        if (m && archive !== 0x7fff && preload === 0) index.set(m[1], { archive, offset, length });
      }
    }
  }
  return index;
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// DXT5 to BGR rows. `ycocg`: luma is in the alpha channel and chroma in
// red and green, which is how the game stores most portraits; read as plain
// colour they come out orange and green.
function dxt5(d, W, H) {
  const px = Buffer.alloc(W * H * 3);
  // A plain, opaque DXT5 picture has alpha 255 throughout; luma never does.
  let flat = true;
  for (let o = 0; o < d.length && flat; o += 16) if (d[o] !== 255 || d[o + 1] !== 255) flat = false;
  const ycocg = !flat;
  let o = 0;
  for (let by = 0; by < H / 4; by++) {
    for (let bx = 0; bx < W / 4; bx++, o += 16) {
      const a0 = d[o], a1 = d[o + 1];
      const al = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) al.push(((7 - i) * a0 + i * a1) / 7);
      else { for (let i = 1; i < 5; i++) al.push(((5 - i) * a0 + i * a1) / 5); al.push(0, 255); }
      const abitsLo = d.readUInt32LE(o + 2) >>> 0, abitsHi = d.readUInt16LE(o + 6);
      const c = [d.readUInt16LE(o + 8), d.readUInt16LE(o + 10)].map((v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31]);
      const pal = [c[0], c[1], c[0].map((v, i) => (2 * v + c[1][i]) / 3), c[0].map((v, i) => (v + 2 * c[1][i]) / 3)];
      const bits = d.readUInt32LE(o + 12);
      for (let i = 0; i < 16; i++) {
        const col = pal[(bits >>> (2 * i)) & 3];
        // 48 bits of 3-bit alpha indices, split over a 32 and a 16.
        const sh = 3 * i;
        const ai = sh < 30 ? (abitsLo >>> sh) & 7 : sh === 30 ? ((abitsLo >>> 30) | (abitsHi << 2)) & 7 : (abitsHi >>> (sh - 32)) & 7;
        let R, G, B;
        if (ycocg) {
          const s = 1 / ((col[2] / 8 | 0) + 1), Y = al[ai], Co = (col[0] - 128) * s, Cg = (col[1] - 128) * s;
          R = Y + Co - Cg; G = Y + Cg; B = Y - Co - Cg;
        } else [R, G, B] = col;
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        const q = ((H - 1 - y) * W + x) * 3;       // a BMP is bottom-up
        px[q] = clamp(B); px[q + 1] = clamp(G); px[q + 2] = clamp(R);
      }
    }
  }
  return px;
}

function bgra(d, W, H) {
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = (y * W + x) * 4, q = ((H - 1 - y) * W + x) * 3;
    px[q] = d[s]; px[q + 1] = d[s + 1]; px[q + 2] = d[s + 2];
  }
  return px;
}

function bmp(px, W, H) {
  const h = Buffer.alloc(54);
  h.write('BM'); h.writeUInt32LE(54 + px.length, 2); h.writeUInt32LE(54, 10); h.writeUInt32LE(40, 14);
  h.writeInt32LE(W, 18); h.writeInt32LE(H, 22); h.writeUInt16LE(1, 26); h.writeUInt16LE(24, 28); h.writeUInt32LE(px.length, 34);
  return Buffer.concat([h, px]);
}

// One compiled texture -> a data: URL, or null if it is not a shape we know.
export function decodeTexture(f) {
  const blocks = 8 + f.readUInt32LE(8), n = f.readUInt32LE(12);
  for (let i = 0; i < n && i < 16; i++) {
    const o = blocks + i * 12;
    if (f.toString('latin1', o, o + 4) !== 'DATA') continue;
    const at = o + 4 + f.readUInt32LE(o + 4), end = at + f.readUInt32LE(o + 8);
    const W = f.readUInt16LE(at + 20), H = f.readUInt16LE(at + 22), fmt = f.readUInt8(at + 26);
    if (!W || !H || W > 512 || H > 512 || W % 4 || H % 4 || end > f.length) return null;
    const d = f.subarray(end);                     // the pixels follow the blocks
    if (fmt === FMT_PNG && d.length > 8 && d.readUInt32BE(0) === 0x89504e47) return 'data:image/png;base64,' + d.toString('base64');
    if (fmt === FMT_DXT5 && d.length === (W / 4) * (H / 4) * 16) return 'data:image/bmp;base64,' + bmp(dxt5(d, W, H), W, H).toString('base64');
    if (fmt === FMT_BGRA && d.length === W * H * 4) return 'data:image/bmp;base64,' + bmp(bgra(d, W, H), W, H).toString('base64');
    return null;
  }
  return null;
}

// faces(gameDotaDir) -> (hero) => data URL | null. Never throws: a game
// folder that is not there, or a pak laid out some new way, is just "no".
export function faces(dotaDir) {
  let index = null;
  const cache = new Map();
  return (hero) => {
    if (!hero || !/^[a-z_]+$/.test(hero)) return null;
    if (cache.has(hero)) return cache.get(hero);
    let url = null;
    try {
      if (!index) index = readIndex(path.join(dotaDir, 'pak01_dir.vpk'));
      const e = index.get(hero);
      if (e && e.length < 1 << 20) {
        const fd = fs.openSync(path.join(dotaDir, 'pak01_' + String(e.archive).padStart(3, '0') + '.vpk'), 'r');
        try { const f = Buffer.alloc(e.length); fs.readSync(fd, f, 0, e.length, e.offset); url = decodeTexture(f); } finally { fs.closeSync(fd); }
      }
    } catch { index = index || new Map(); }
    cache.set(hero, url);
    return url;
  };
}
