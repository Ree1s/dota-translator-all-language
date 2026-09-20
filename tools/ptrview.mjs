// Reads what tools/ptrscan.ps1 wrote and says what is REGULAR in it.
//
//   node tools/ptrview.mjs [ptrscan.log] [--rows N]
//
// A pointer scan of a game is mostly noise: stale copies, stack slots,
// allocator bookkeeping. What marks the real thing is repetition, so
// every section here is a count of something that ought to repeat:
//
//   pointsAt  what text a level-1 pointer points at. The real start of a
//             line is the same few characters every time.
//   objects   for each holder, the nearest module address BEFORE it - a
//             vtable, so the start of the object the holder is a field
//             of - as "class @ +offset". Twelve lines held by twelve
//             objects of one class at one offset is the label.
//   arrays    a holder whose neighbours point at the objects of the
//             level below: the children array of whatever holds them.
//
// A module offset is the same on the next run and an address is not, so
// classes are named by offset and everything else is relative.

import fs from 'node:fs';

const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ptrscan.log';
const rowsArg = process.argv.indexOf('--rows');
const SHOW = rowsArg < 0 ? 8 : Number(process.argv[rowsArg + 1]);

const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Only the LAST run in the file: addresses from two runs mean nothing together.
const lastRun = rows.map((r) => r.t).lastIndexOf('run');
const run = rows.slice(Math.max(0, lastRun));
const modules = run.filter((r) => r.t === 'module').map((m) => ({ name: m.name, base: BigInt(m.base), size: BigInt(m.size) }));
const strs = run.filter((r) => r.t === 'str');
const ptrs = run.filter((r) => r.t === 'ptr');

const hex = (n) => '0x' + n.toString(16);
const moduleOf = (a) => {
  for (const m of modules) if (a >= m.base && a < m.base + m.size) return `${m.name}+${hex(a - m.base)}`;
  return null;
};
const qwords = (p) => {
  const buf = Buffer.from(p.ctx, 'hex'), base = BigInt(p.ctxBase), out = [];
  for (let i = 0; i + 8 <= buf.length; i += 8) out.push({ at: base + BigInt(i), v: buf.readBigUInt64LE(i) });
  return out;
};
const tally = (list, key) => {
  const m = new Map();
  for (const x of list) { const k = key(x); if (k !== null && k !== undefined) m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const show = (title, pairs) => {
  console.log('  ' + title);
  for (const [k, n] of pairs.slice(0, SHOW)) console.log(`    ${String(n).padStart(5)}  ${k}`);
  if (pairs.length > SHOW) console.log(`           ... and ${pairs.length - SHOW} more`);
};

/// The objects a holder MIGHT be a field of: every qword before it that
/// is an address inside a module, which is what a vtable pointer is.
/// Nearest is not always right - an object can embed another with a
/// vtable of its own - so all of them are counted, and the right one is
/// the one that repeats once per line.
function objectsOf(p) {
  const holder = BigInt(p.holder), out = [];
  for (const q of qwords(p)) {
    if (q.at >= holder || holder - q.at > 0x200n) continue;
    const mod = moduleOf(q.v);
    if (mod) out.push(`${mod} @ +${hex(holder - q.at)}`);
  }
  return out;
}

console.log(`${file}: ${strs.length} chat lines, ${ptrs.length} pointers, ${modules.length} modules`);
const levels = [...new Set(ptrs.map((p) => p.level))].sort();

for (const level of levels) {
  const at = ptrs.filter((p) => p.level === level);
  console.log(`\nLEVEL ${level}: ${at.length} pointers`);
  show('held in', tally(at, (p) => (p.kind === 'image' ? `image ${(p.mod || '').split('+')[0]}` : p.kind)));
  if (level === 1) show('points at', tally(at, (p) => JSON.stringify((p.pointsAt || '').slice(0, 24))));
  // How the thing pointed AT relates to a holder of the level below:
  // "obj+0x98" twelve times over is twelve objects with a line at +0x98.
  else show('points at (relative to a holder of the level below)', tally(at, (p) => (p.via || '?').replace(/^array\[\d+\]$/, 'array start')));

  show('this holder is at: class @ +offset', tally(at.flatMap(objectsOf), (x) => x));

  // Roots: a pointer kept in a module's own data is found again next run
  // at the same module offset, with no sweep at all.
  const roots = at.filter((p) => p.kind === 'image');
  if (roots.length) show('ROOTS (module data)', roots.map((p) => [`${p.mod} -> ${p.value} (${p.via || 'line'})`, 1]));

  const arrays = at.filter((p) => /^array/.test(p.via || ''));
  if (arrays.length) show('holders of an ARRAY START', arrays.map((p) => [`${p.holder} -> ${p.value} (${p.kind}; ${objectsOf(p).slice(-2).join(' | ') || 'no class seen'})`, 1]));
}
