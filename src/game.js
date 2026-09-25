import fs from 'node:fs';
// Packaged War3 builds select their mode without relying on shortcut arguments.
export function selectGame(args = process.argv, metadata = {}) {
  return args.includes('--war3') || metadata.defaultGame === 'war3' ? 'war3' : 'dota';
}
let metadata = {};
try { metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')); } catch {}
export const GAME = selectGame(process.argv, metadata);
export const PRODUCT_NAME = GAME === 'war3' ? 'Warcraft Chat Translator' : 'Dota Translator';
