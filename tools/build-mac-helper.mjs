import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') {
  console.error('The Mac helper must be compiled on macOS with Xcode Command Line Tools (xcode-select --install).');
  process.exit(1);
}
const arch = process.env.DT_MAC_ARCH || process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Supported Mac architectures: arm64, x64');
const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
const out = path.join(root, 'native/mac/war3-helper');
execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos11.0`, '-sdk', sdk, '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', path.join(root, 'native/mac/War3Helper.swift'), '-o', out], { stdio: 'inherit' });
fs.chmodSync(out, 0o755);
// Stable identifier for local permission testing; distribution signing replaces this.
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'com.ree1s.war3-helper', out], { stdio: 'inherit' });
console.log(`Built Mac helper: ${arch}`);
