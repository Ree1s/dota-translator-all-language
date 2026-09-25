import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MAC_HELPER, macHelperArgs } from './mac-helper.js';
if (process.platform !== 'darwin') { console.error('Run doctor:mac on your Mac.'); process.exit(1); }
if (!fs.existsSync(MAC_HELPER)) { console.error('Missing helper: run npm run build:mac-helper first.'); process.exit(1); }
for (const mode of ['discover', 'permissions']) {
  console.log(execFileSync(MAC_HELPER, macHelperArgs(mode), { encoding: 'utf8', timeout: 5000 }).trim());
}
console.log('Esc -> English; Shift+Esc -> savage English. Live capture/paste/fullscreen is not yet verified.');
