import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAC_HELPER = path.join(root, 'native', 'mac', 'war3-helper').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
export function macHelperArgs(mode, { processName = '', parentPid = process.pid, env = process.env, hotkeysEnabled = true } = {}) {
  const args = ['--mode', mode, '--process', processName || env.DT_WAR3_PROCESS || 'Warcraft III', '--parent', String(parentPid)];
  args.push('--hotkeys', String(hotkeysEnabled));
  if (env.DT_WAR3_BUNDLE_ID) args.push('--bundle', env.DT_WAR3_BUNDLE_ID);
  args.push('--copy-modifier', env.DT_MAC_COPY_MODIFIER === 'control' ? 'control' : 'command');
  args.push('--selection', env.DT_MAC_SELECTION === 'command-arrows' ? 'command-arrows' : 'end-home');
  return args;
}
