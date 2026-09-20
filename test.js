// Plain node assert, no runner: node test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseChatLine, chatToTranslate, needsTranslation, libraryPaths, logCandidates, LogTail } from './src/chatlog.js';
import { buildRequest, replyTextFrom, translationsFrom, translateBatch } from './src/translate.js';
import { createPipeline } from './src/pipeline.js';
import { mergeConfig, DEFAULTS } from './src/config.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const okAsync = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-')), 'console.log');

console.log('chatlog');

ok('a chat line splits into a name and a message', () => {
  assert.deepEqual(parseChatLine('Kristjan: go mid'), { name: 'Kristjan', text: 'go mid' });
  assert.deepEqual(parseChatLine('Иван: го рошан'), { name: 'Иван', text: 'го рошан' });
});

ok('a message keeping its own colon is not split twice', () => {
  assert.deepEqual(parseChatLine('Vlad: 10:30 rosh'), { name: 'Vlad', text: '10:30 rosh' });
});

ok('engine output is not chat', () => {
  assert.equal(parseChatLine('[Steam] Loaded 12 items'), null);
  assert.equal(parseChatLine('  indented: thing'), null);
  assert.equal(parseChatLine('CDOTA_Unit: spawned'), null);
  assert.equal(parseChatLine('client.dll: loaded'), null);
  assert.equal(parseChatLine('Failed: could not open file'), null);
  assert.equal(parseChatLine(''), null);
  assert.equal(parseChatLine('no colon here'), null);
});

ok('a name longer than Steam allows is not a name', () => {
  assert.equal(parseChatLine('x'.repeat(40) + ': hi'), null);
});

ok('an empty message is dropped', () => {
  assert.equal(parseChatLine('Kristjan: '), null);
  assert.equal(parseChatLine('Kristjan:    '), null);
});

ok('a trailing carriage return is not part of the message', () => {
  assert.deepEqual(parseChatLine('Kristjan: gg\r'), { name: 'Kristjan', text: 'gg' });
});

ok('only a script we cannot read is worth a call', () => {
  assert.equal(needsTranslation('go mid'), false);
  assert.equal(needsTranslation('го мид'), true);
  assert.equal(needsTranslation('日本語', ['cyrillic']), false);
  assert.equal(needsTranslation('日本語', ['cyrillic', 'han']), true);
});

ok('chatToTranslate takes Russian chat and leaves everything else', () => {
  assert.deepEqual(chatToTranslate('Иван: го рошан', ['cyrillic']), { name: 'Иван', text: 'го рошан' });
  assert.equal(chatToTranslate('Kristjan: go rosh', ['cyrillic']), null);
  // The script gate is what makes the parser safe: engine output is
  // ASCII, so it can never pass this however odd the line looks.
  assert.equal(chatToTranslate('[Steam] Loaded', ['cyrillic']), null);
});

ok('the steam library list is read out of the vdf', () => {
  const vdf = '"libraryfolders"{"0"{"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"}"1"{"path"\t\t"D:\\\\SteamLibrary"}}';
  assert.deepEqual(libraryPaths(vdf), ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  assert.deepEqual(libraryPaths(''), []);
});

ok('a library listed twice yields one candidate', () => {
  const list = logCandidates('C:\\Steam', '"path" "C:\\\\Steam"');
  assert.equal(list.length, 1);
  assert.match(list[0], /console\.log$/);
});

console.log('LogTail');

ok('the tail starts at the end and reads only what follows', () => {
  const file = tmpLog();
  fs.writeFileSync(file, 'old line\n');
  const seen = [];
  const tail = new LogTail(file, { intervalMs: 10 });
  tail.onLine = (l) => seen.push(l);
  tail.poll();                                    // adopts the end
  fs.appendFileSync(file, 'Ivan: privet\n');
  tail.poll();
  assert.deepEqual(seen, ['Ivan: privet']);
});

ok('a half-written line is held until its newline arrives', () => {
  const file = tmpLog();
  fs.writeFileSync(file, '');
  const seen = [];
  const tail = new LogTail(file, { intervalMs: 10 });
  tail.onLine = (l) => seen.push(l);
  tail.poll();
  fs.appendFileSync(file, 'Ivan: pri');
  tail.poll();
  assert.deepEqual(seen, []);
  fs.appendFileSync(file, 'vet\n');
  tail.poll();
  assert.deepEqual(seen, ['Ivan: privet']);
});

ok('a truncated log is a new game, not an error', () => {
  const file = tmpLog();
  fs.writeFileSync(file, 'a long first session line\n');
  const seen = [];
  const tail = new LogTail(file, { intervalMs: 10 });
  tail.onLine = (l) => seen.push(l);
  tail.poll();
  fs.writeFileSync(file, 'new\n');                // Dota rewrites it on launch
  tail.poll();
  assert.deepEqual(seen, ['new']);
});

ok('a log that is not there yet is waited for, not thrown on', () => {
  const file = tmpLog();
  const seen = [];
  let errors = 0;
  const tail = new LogTail(file, { intervalMs: 10 });
  tail.onLine = (l) => seen.push(l);
  tail.onError = () => { errors++; };
  tail.poll();
  assert.equal(errors, 1);
  fs.writeFileSync(file, 'Ivan: privet\n');
  tail.poll();                                    // adopts the end of a new file
  fs.appendFileSync(file, 'Petr: da\n');
  tail.poll();
  assert.deepEqual(seen, ['Petr: da']);
});

console.log('translate');

ok('the request carries the lines and asks for JSON back', () => {
  const req = buildRequest([{ name: 'Ivan', text: 'го рошан' }]);
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(JSON.parse(req.contents[0].parts[0].text), [{ i: 0, name: 'Ivan', text: 'го рошан' }]);
});

ok('a long message is capped before it is sent', () => {
  const sent = JSON.parse(buildRequest([{ name: 'x'.repeat(50), text: 'я'.repeat(600) }]).contents[0].parts[0].text);
  assert.equal(sent[0].name.length, 32);
  assert.equal(sent[0].text.length, 400);
});

ok('the reply text is joined out of the parts', () => {
  assert.equal(replyTextFrom({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(replyTextFrom({}), '');
  assert.equal(replyTextFrom(null), '');
});

ok('translations are read by index', () => {
  const map = translationsFrom('[{"i":0,"en":"go roshan"},{"i":1,"en":"mid missing"}]');
  assert.equal(map.get(0), 'go roshan');
  assert.equal(map.get(1), 'mid missing');
});

ok('a reply wrapped in prose is still read', () => {
  assert.equal(translationsFrom('Here you go:\n[{"i":0,"en":"go roshan"}]\nhope that helps').get(0), 'go roshan');
});

ok('a reply that is not JSON at all costs nothing', () => {
  assert.equal(translationsFrom('sorry, I cannot').size, 0);
  assert.equal(translationsFrom('').size, 0);
});

ok('a row without a usable index or text is skipped', () => {
  const map = translationsFrom('[{"i":"x","en":"a"},{"i":1},{"i":2,"en":"  "},{"i":3,"en":"ok"}]');
  assert.deepEqual([...map.entries()], [[3, 'ok']]);
});

await okAsync('a line the model dropped falls back to what was said', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"i":0,"en":"go roshan"}]' }] } }] }),
  });
  const out = await translateBatch(
    [{ name: 'Ivan', text: 'го рошан' }, { name: 'Petr', text: 'мид сс' }],
    { apiKey: 'k', fetchImpl },
  );
  assert.deepEqual(out[0], { name: 'Ivan', text: 'го рошан', en: 'go roshan', translated: true });
  assert.deepEqual(out[1], { name: 'Petr', text: 'мид сс', en: 'мид сс', translated: false });
});

await okAsync('an http error is reported in the server own words', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota exceeded' } }) });
  await assert.rejects(
    () => translateBatch([{ name: 'a', text: 'б' }], { apiKey: 'k', fetchImpl }),
    /quota exceeded/,
  );
});

await okAsync('no key is refused before any call is made', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  await assert.rejects(() => translateBatch([{ name: 'a', text: 'б' }], { apiKey: '', fetchImpl }), /API key/);
  assert.equal(called, false);
});

console.log('pipeline');

await okAsync('lines arriving together go out as one call', async () => {
  let calls = 0;
  const seen = [];
  const pipe = createPipeline({
    batchMs: 20,
    translate: async (batch) => { calls++; return batch.map((b) => ({ ...b, en: 'EN ' + b.text, translated: true })); },
    onResult: (r) => seen.push(r.en),
  });
  pipe.push({ name: 'a', text: '1' });
  pipe.push({ name: 'b', text: '2' });
  pipe.push({ name: 'c', text: '3' });
  await tick(80);
  assert.equal(calls, 1);
  assert.deepEqual(seen, ['EN 1', 'EN 2', 'EN 3']);
});

await okAsync('a full batch goes at once instead of waiting', async () => {
  let calls = 0;
  const pipe = createPipeline({
    batchMs: 5000, maxBatch: 2,
    translate: async (batch) => { calls++; return batch.map((b) => ({ ...b, en: b.text, translated: true })); },
    onResult: () => {},
  });
  pipe.push({ name: 'a', text: '1' });
  pipe.push({ name: 'b', text: '2' });
  await tick(40);
  assert.equal(calls, 1);
});

await okAsync('a failed translation still shows what was said', async () => {
  const seen = [];
  let err = null;
  const pipe = createPipeline({
    batchMs: 10,
    translate: async () => { throw new Error('quota exceeded'); },
    onResult: (r) => seen.push(r),
    onError: (e) => { err = e; },
  });
  pipe.push({ name: 'Ivan', text: 'го рошан' });
  await tick(50);
  assert.equal(err.message, 'quota exceeded');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].en, 'го рошан');
  assert.equal(seen[0].translated, false);
});

await okAsync('more lines than one batch holds are all delivered, in order', async () => {
  const seen = [];
  const pipe = createPipeline({
    batchMs: 10, maxBatch: 2,
    translate: async (batch) => { await tick(10); return batch.map((b) => ({ ...b, en: b.text, translated: true })); },
    onResult: (r) => seen.push(r.en),
  });
  for (const n of ['1', '2', '3', '4', '5']) pipe.push({ name: 'a', text: n });
  await tick(300);
  assert.deepEqual(seen, ['1', '2', '3', '4', '5']);
});

console.log('config');

ok('a missing or malformed field falls back to the default', () => {
  const cfg = mergeConfig({ fontSize: 'big', holdSeconds: 30, nonsense: 1 });
  assert.equal(cfg.fontSize, DEFAULTS.fontSize);
  assert.equal(cfg.holdSeconds, 30);
  assert.equal(cfg.nonsense, undefined);
});

ok('scripts must be a list to be taken', () => {
  assert.deepEqual(mergeConfig({ scripts: ['cyrillic', 'han'] }).scripts, ['cyrillic', 'han']);
  assert.deepEqual(mergeConfig({ scripts: 'cyrillic' }).scripts, DEFAULTS.scripts);
});

ok('the env key wins over the file', () => {
  const before = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'from-env';
  assert.equal(mergeConfig({ geminiApiKey: 'from-file' }).geminiApiKey, 'from-env');
  if (before === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before;
});

console.log('build');

ok('every script parses', () => {
  const files = fs.readdirSync('src').filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));
  assert.ok(files.length >= 7, 'expected the whole src folder, got ' + files.length);
  for (const f of files) execFileSync(process.execPath, ['--check', path.join('src', f)]);
});

console.log('\n' + passed + ' passed');
