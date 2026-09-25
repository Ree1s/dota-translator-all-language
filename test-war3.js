import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createOutgoing, buildOutRequest, languageFromHotkey } from './src/outgoing.js';
import { startFocusWatch } from './src/focuswatch.js';
import { createKeySender, sayTranslated } from './src/sendchat.js';
import { POWERSHELL } from './src/memsource.js';
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ok ', name); }
const source = f => fs.readFileSync('src/' + f, 'utf8');
function child() { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stdout.setEncoding = () => {}; c.stdin = new EventEmitter(); c.stdin.write = () => {}; c.stdin.end = () => {}; c.kill = () => {}; return c; }
await test('Dota defaults and configurable spaced Warcraft process names', () => {
  for (const f of ['sendchat.ps1', 'focuswatch.ps1']) assert.match(source(f), /ProcessName = 'dota2'/);
  let args; const c = child(); const focus = startFocusWatch({ processName: 'Warcraft III', spawnImpl: (_p, a) => { args = a; return c; } });
  assert.equal(args[args.indexOf('-ProcessName') + 1], 'Warcraft III'); focus.stop();
  const keys = createKeySender({ processName: 'Warcraft III', spawnImpl: (_p, a) => { args = a; return child(); } }); keys.warm();
  assert.equal(args.at(-1), 'Warcraft III'); keys.stop();
  assert.match(source('main.js'), /war3Discovery.processes\[0\]\?\.name/);
});
await test('all eight chords retain style and numbered language', () => {
  const c = child(), heard = []; const w = startFocusWatch({ onHotkey: k => heard.push(k), spawnImpl: () => c });
  for (const shift of ['', 'Shift+']) for (const digit of ['', '+1', '+2', '+3']) {
    const key = `Control+${shift}Enter${digit}`;
    c.stdout.emit('data', JSON.stringify({ t: 'hotkey', key }) + '\n');
    assert.equal(languageFromHotkey(key, ['English', 'Russian', 'Filipino']), digit ? ['English', 'Russian', 'Filipino'][Number(digit[1])-1] : '');
    assert.equal(key.includes('+Shift+') ? 'savage' : 'faithful', shift ? 'savage' : 'faithful');
  }
  assert.equal(heard.length, 8); w.stop();
  for (const n of '0456789') assert.equal(languageFromHotkey('Control+Shift+Enter+' + n, ['English', 'Russian', 'Filipino']), '');
  const ps = source('focuswatch.ps1'); assert.match(ps, /if \(-not \$hotkeySent\)/); assert.match(ps, /\$hotkeySent = \$true/);
});
await test('War3 own-key only, prompt context, cache and style isolation', async () => {
  let calls = 0, remote = 0, stored;
  const say = createOutgoing({ game: 'war3', apiKey: 'test-secret', remote: () => { remote++; }, ask: async ({ request }) => {
    calls++; const prompt = request.systemInstruction.parts[0].text;
    assert.match(prompt, /Warcraft III/); assert.doesNotMatch(prompt, /Dota|Roshan|BKB|buyback|actual lanes/);
    assert.doesNotMatch(prompt, /test-secret/); return JSON.stringify({ out: 'out' + calls });
  }, store: { read: () => ({}), write: data => { stored = data; } } });
  assert.notEqual((await say('test', 'Russian')).out, (await say('test', 'Russian', 'savage')).out);
  assert.equal((await say('test', 'Russian')).cached, true); assert.equal(calls, 2); assert.equal(remote, 0);
  assert.deepEqual(Object.keys(stored), ['Russian|faithful|test', 'Russian|savage|test']);
  await assert.rejects(createOutgoing({ game: 'war3', remote: () => { throw Error('hosted called'); } })('x', 'English'), /requires your Gemini API key/);
  assert.match(buildOutRequest('x', 'Russian').systemInstruction.parts[0].text, /Dota/);
  assert.match(source('main.js'), /game !== 'war3' &&/); assert.match(source('main.js'), /said-war3.json/);
});
await test('clipboard restores on War3 success and foreground refusal', async () => {
  for (const success of [true, false]) {
    let text = 'original';
    const result = await sayTranslated({ clipboard: { readText: () => text, writeText: t => { text = t; } }, keys: { copy: async () => { text = 'typed'; return { ok: true }; }, send: async () => ({ ok: success, why: 'focus lost' }) }, translate: async () => ({ out: 'translated' }), restoreOnFailure: true, wait: async () => {} });
    assert.equal(text, 'original'); assert.equal(result.said, success);
  }
});
await test('PowerShell helper syntax parses', () => {
  const script = `$bad = 0; foreach ($f in @('src/focuswatch.ps1','src/sendchat.ps1')) { $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $f),[ref]$tokens,[ref]$errors); if ($errors.Count) { $bad++; Write-Output $errors } }; exit $bad`;
  execFileSync(POWERSHELL, ['-NoProfile','-Command', script], { windowsHide: true });
});
console.log(`${passed} War3 groups passed`);
await test('War3 accepts only F6-F9 with optional Shift; old Ctrl chords are ignored', () => {
  const c = child(), heard = []; let args;
  const watcher = startFocusWatch({ game: 'war3', onHotkey: k => heard.push(k), spawnImpl: (_p, a) => { args = a; return c; } });
  const expected = ['F6','F7','F8','F9','Shift+F6','Shift+F7','Shift+F8','Shift+F9'];
  for (const key of [...expected, 'Control+Enter', 'Control+Enter+1', 'Control+Shift+Enter+2', 'F1', 'Control+F7']) c.stdout.emit('data', JSON.stringify({ t: 'hotkey', key }) + '\n');
  assert.deepEqual(heard, expected);
  assert.equal(args[args.indexOf('-Game') + 1], 'war3');
  watcher.stop();
});
await test('independent composer translates without capturing game text and copies only on request', async () => {
  const { createComposer } = await import('./src/composer.js');
  let text = 'original', calls = [];
  const c = createComposer({ clipboard: { readText: () => text, writeText: value => { text = value; } }, translate: async (...args) => { calls.push(args); return { out: 'go creep' }; } });
  assert.equal((await c.translate({ text: '先练级', language: 'English', style: 'faithful' })).ok, true);
  assert.deepEqual(calls, [['先练级', 'English', 'faithful']]);
  assert.equal(text, 'original'); assert.equal(c.copy(), true); assert.equal(text, 'go creep');
  assert.equal(c.restore(), true); assert.equal(text, 'original');
  c.copy(); text = 'new clipboard'; assert.equal(c.restore(), false); assert.equal(text, 'new clipboard');
  assert.equal((await c.translate({ text: '', language: 'English', style: 'faithful' })).ok, false);
  assert.equal((await c.translate({ text: 'x', language: 'invalid', style: 'faithful' })).ok, false);
});
await test('composer prevents concurrent requests and hides provider errors', async () => {
  const { createComposer } = await import('./src/composer.js');
  let reject;
  const c = createComposer({ clipboard: {}, translate: () => new Promise((_resolve, r) => { reject = r; }) });
  const payload = { text: 'x', language: 'English', style: 'savage' };
  const pending = c.translate(payload);
  assert.equal((await c.translate(payload)).ok, false);
  reject(new Error('private-key-example'));
  const result = await pending;
  assert.equal(result.ok, false); assert.doesNotMatch(result.why, /private-key-example/);
});
await test('War3 selects with End and Shift+Home while Dota retains Ctrl+A', () => {
  let args; const c = child();
  const sender = createKeySender({ game: 'war3', processName: 'Warcraft III', clipboardKeys: 'insert', spawnImpl: (_p, a) => { args = a; return c; } });
  sender.warm();
  assert.equal(args[args.indexOf('-Game') + 1], 'war3');
  assert.equal(args[args.indexOf('-ClipboardKeys') + 1], 'insert');
  sender.stop();
  const ps = source('sendchat.ps1');
  assert.match(ps, /if \(\$Game -eq 'war3'\)[\s\S]*Tap\(\[SayKeys\]::END\)[\s\S]*InFront\(\$id\)[\s\S]*Chord\(\[SayKeys\]::SHIFT, \[SayKeys\]::HOME\)/);
  assert.match(ps, /else \{\s*\[SayKeys\]::Chord\(\[SayKeys\]::CTRL, \[SayKeys\]::A\)/);
  assert.match(ps, /KEYUP \| Extended\(vk\)/);
  const main = source('main.js');
  const diagnostic = main.slice(main.indexOf('async function captureWar3()'), main.indexOf('// WHO the player'));
  assert.match(diagnostic, /finally \{ clipboard.writeText\(before\)/);
  assert.doesNotMatch(diagnostic, /keys.send|sayIt\(|openComposer\(/);
});
