import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAC_HELPER, macHelperArgs } from './mac-helper.js';
import os from 'node:os';
import { POWERSHELL } from './memsource.js';

// Only Windows process metadata, known folders and Blizzard registry entries.
export function discoverWar3() {
  if (process.platform === 'darwin') {
    try { return JSON.parse(execFileSync(MAC_HELPER, macHelperArgs('discover'), { encoding: 'utf8', timeout: 5000 })); }
    catch { return { processes: [], roots: [path.join(os.homedir(), 'Documents', 'Warcraft III'), path.join(os.homedir(), 'Library', 'Application Support', 'Blizzard', 'Warcraft III')].filter(p => fs.existsSync(p)), error: 'Build the native helper on a Mac with npm run build:mac-helper' }; }
  }
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = @(Get-Process | Where-Object { $_.ProcessName -match '^(Warcraft III|war3)$' } | ForEach-Object { @{ name=$_.ProcessName; pid=$_.Id; path=$_.Path } })
$roots = @((Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Warcraft III'))
foreach ($key in @('HKCU:\\Software\\Blizzard Entertainment\\Warcraft III','HKLM:\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Warcraft III')) {
  $v = Get-ItemProperty -LiteralPath $key
  if ($v.'InstallPath') { $roots += $v.'InstallPath' }
}
foreach ($p in $procs) { if ($p.path) { $roots += Split-Path -Parent $p.path } }
foreach ($base in @($env:ProgramFiles, \${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:APPDATA, $env:PROGRAMDATA)) {
  if ($base) { $roots += Join-Path $base 'Warcraft III'; $roots += Join-Path $base 'Battle.net\\Logs' }
}
@{ processes=$procs; roots=@($roots | Select-Object -Unique | Where-Object { Test-Path -LiteralPath $_ }) } | ConvertTo-Json -Depth 4 -Compress
`;
  try { return JSON.parse(execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 })); }
  catch { return { processes: [], roots: [], error: 'Windows discovery failed' }; }
}

export function snapshot(roots) {
  const files = new Map();
  let visited = 0;
  function walk(dir, depth) {
    if (depth > 5 || visited > 5000) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++visited > 5000) break;
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!/^(Data|Maps|Campaigns|node_modules)$/i.test(e.name)) walk(file, depth + 1); }
      else if (/\.(log|txt|w3g)$/i.test(e.name)) {
        try { const s = fs.statSync(file); files.set(file, { size: s.size, mtime: s.mtimeMs }); } catch {}
      }
    }
  }
  roots.forEach(dir => walk(dir, 0));
  return files;
}

export function changes(before, after) {
  const result = [];
  for (const [file, now] of after) {
    const old = before.get(file);
    if (old && old.size === now.size && old.mtime === now.mtime) continue;
    const row = { file, before: old?.size ?? null, size: now.size, appended: '' };
    // Only bounded append-only text; never dump binary replays or historical files.
    if (old && now.size > old.size && now.size - old.size <= 65536 && /\.(txt|log)$/i.test(file)) {
      let fd;
      try {
        fd = fs.openSync(file, 'r'); const b = Buffer.alloc(now.size - old.size);
        const n = fs.readSync(fd, b, 0, b.length, old.size);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n));
        if (!/[\x00-\x08\x0e-\x1f]/.test(text)) row.appended = text.replace(/AIza[\w-]+/g, '[REDACTED]');
      } catch {} finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    result.push(row);
  }
  for (const file of before.keys()) if (!after.has(file)) result.push({ file, deleted: true });
  return result;
}
