// Plain node assert, no runner: node test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseChatLine, chatToTranslate, needsTranslation, libraryPaths, logCandidates, LogTail, findDotaLog } from './src/chatlog.js';
import { buildRequest, replyTextFrom, translationsFrom, translateBatch, askGeminiHedged, HEDGE_AFTER_MS, ATTEMPT_MS } from './src/translate.js';
import { createPipeline } from './src/pipeline.js';
import { parseMemoryChatLine, parseMarkupChatLine, createLineTracker, readMemoryFindings, unknownChannelTag, PERSONA, MAX_LINE, MAX_NAME } from './src/chatmem.js';
import { parseEvent, scannerArgs, nearestDistance, POWERSHELL, startMemorySource } from './src/memsource.js';
import { EventEmitter } from 'node:events';
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

ok('a machine with no Dota at all is told so, not handed a path', () => {
  // Nothing of the caller's is on disk in the test environment, so the
  // lookup must report "not installed" rather than a path that is only a
  // guess. An install WITH no log yet is the opposite case and is covered
  // by the doctor, which waits for the file instead of exiting.
  const found = findDotaLog();
  assert.equal(typeof found, 'object');
  assert.ok('path' in found && 'exists' in found && 'installed' in found);
  if (!found.installed) {
    assert.equal(found.path, null);
    assert.equal(found.exists, false);
  } else {
    assert.equal(typeof found.path, 'string');
    assert.equal(found.exists, fs.existsSync(found.path));
  }
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

console.log('chatmem');

ok('a line read out of memory splits into channel, name and message', () => {
  assert.deepEqual(parseMemoryChatLine('  [Allies] unc status: не фидите, у них варды на руне'), {
    channel: 'team', channelTag: 'Allies', name: 'unc status', text: 'не фидите, у них варды на руне',
  });
  assert.deepEqual(parseMemoryChatLine('[All] Иван: го рошан'), {
    channel: 'all', channelTag: 'All', name: 'Иван', text: 'го рошан',
  });
});

ok('a message keeping its own colon is not split twice', () => {
  assert.equal(parseMemoryChatLine('[All] Vlad: 10:30 rosh').text, '10:30 rosh');
});

ok("Panorama's markup copy of a line is not read as a player", () => {
  // The same line exists twice in memory; the markup copy must not win.
  const markup = '[Allies] <span class="ChatPersona"><span class="PlayerColor4">준우</span></span>: gg';
  assert.equal(parseMemoryChatLine(markup), null);
});

ok('freed and half-overwritten memory is not a chat line', () => {
  assert.equal(parseMemoryChatLine('[Allies]  : x'), null);
  assert.equal(parseMemoryChatLine('[Allies] name: ���'), null);
  assert.equal(parseMemoryChatLine('[Allies] '), null);
  assert.equal(parseMemoryChatLine('[Allies] name: '), null);
  assert.equal(parseMemoryChatLine('e_dive_corrosive_rope02.vpcf'), null);
  assert.equal(parseMemoryChatLine(''), null);
  assert.equal(parseMemoryChatLine(null), null);
});

ok('an unknown channel tag is refused', () => {
  // Closed list on purpose: an unknown tag is how a false positive gets in.
  assert.equal(parseMemoryChatLine('[Steam] Loaded: 12 items'), null);
  assert.equal(parseMemoryChatLine('[Console] thing: value'), null);
});

ok('a line longer than a player could send is not a line', () => {
  assert.equal(parseMemoryChatLine('[All] n: ' + 'x'.repeat(MAX_LINE)), null);
  assert.equal(parseMemoryChatLine('[All] ' + 'n'.repeat(MAX_NAME + 1) + ': hi'), null);
});

ok('the same line living at many addresses is ONE line', () => {
  // The scan finds every copy; the player said it once.
  const t = createLineTracker();
  const one = parseMemoryChatLine('[Allies] unc status: иди мид');
  assert.equal(t.accept([one, one, one]).length, 1);
});

ok('a line already seen is not handed over twice', () => {
  const t = createLineTracker();
  const one = parseMemoryChatLine('[Allies] unc status: иди мид');
  assert.equal(t.accept([one, one]).length, 1);
  assert.equal(t.accept([one, one]).length, 0);
  assert.equal(t.accept([one]).length, 0);
});

ok('the same words repeated are shown once, on purpose', () => {
  // The price of dedup-by-content. Counting copies to catch a genuine
  // repeat does not work: the number of buffers a line lives in is not
  // fixed, so a rising count cannot be told from ordinary churn, and that
  // rule invents messages nobody sent.
  const t = createLineTracker();
  const one = parseMemoryChatLine('[Allies] unc status: иди мид');
  assert.equal(t.accept([one]).length, 1);
  assert.equal(t.accept([one, one]).length, 0);
});

ok('a line said again after the tracker has rolled over is new again', () => {
  const t = createLineTracker({ capacity: 2 });
  const one = parseMemoryChatLine('[Allies] unc status: иди мид');
  assert.equal(t.accept([one]).length, 1);
  t.accept([parseMemoryChatLine('[All] a: x'), parseMemoryChatLine('[All] b: y')]);
  assert.equal(t.accept([one]).length, 1);
});

ok('two players saying the same words stay two lines', () => {
  const t = createLineTracker();
  const a = parseMemoryChatLine('[Allies] Иван: гг');
  const b = parseMemoryChatLine('[Allies] Пётр: гг');
  assert.equal(t.accept([a, b]).length, 2);
});

ok('the tracker does not grow without limit', () => {
  const t = createLineTracker({ capacity: 10 });
  for (let i = 0; i < 50; i++) t.accept([parseMemoryChatLine('[All] n: msg' + i)]);
  assert.ok(t.size <= 10, 'kept ' + t.size);
});

ok('a new match forgets the last one', () => {
  const t = createLineTracker();
  const one = parseMemoryChatLine('[Allies] unc status: иди мид');
  assert.equal(t.accept([one]).length, 1);
  t.reset();
  assert.equal(t.accept([one]).length, 1);
});

ok('findings are split into lines and rejects', () => {
  const { lines, rejected } = readMemoryFindings([
    '  [Allies] unc status: иди мид',
    'e_dive_corrosive_rope02.vpcf',
    '[All] Иван: го рошан',
    '',
  ]);
  assert.equal(lines.length, 2);
  assert.equal(rejected, 2);
});

// The strings below are VERBATIM from Dota's memory, 2026-09-20.
const MARKUP_ALL = 'arget"> <span class="ChatPersona"><span class="PlayerColor0">'
  + '<font color=\'#3375FF\'>unc status</font></span></span></span>: hello</span>';
const MARKUP_TEAM = 'Allies] <span class="ChatPersona"><span class="PlayerColor4">'
  + '<font color=\'#FF6B00\'>Pablo</font></span></span></span>: Pushing mid</span>';

ok('ALL-CHAT is read, though it carries no channel tag', () => {
  // The whole reason this parser exists: the plain pre-formatted string
  // tags team chat "[Allies] " and leaves all-chat untagged, so anchoring
  // on tags found team chat and missed every word of all-chat, silently.
  const line = parseMarkupChatLine(MARKUP_ALL);
  assert.equal(line.channel, 'all');
  assert.equal(line.name, 'unc status');
  assert.equal(line.text, 'hello');
  assert.equal(line.slot, 0);
});

ok('team chat keeps its channel, read from the tag before the anchor', () => {
  const line = parseMarkupChatLine('[' + MARKUP_TEAM);
  assert.equal(line.channel, 'team');
  assert.equal(line.channelTag, 'Allies');
  assert.equal(line.name, 'Pablo');
  assert.equal(line.text, 'Pushing mid');
  assert.equal(line.slot, 4);
});

ok('a clipped opening bracket still reads as team chat', () => {
  // The scanner looks back a bounded number of bytes from the anchor, so
  // a long name can push "[" out of the window. The closing bracket is
  // what keeps this unambiguous - all-chat ends 'ChatTarget"> '.
  assert.equal(parseMarkupChatLine(MARKUP_TEAM).channel, 'team');
  assert.equal(parseMarkupChatLine(MARKUP_ALL).channel, 'all');
});

ok('a non-ASCII name survives the markup', () => {
  const s = 'Allies] <span class="ChatPersona"><span class="PlayerColor2">'
    + '<font color=\'#BF00BF\'>小志</font></span></span></span>: не фидите</span>';
  const line = parseMarkupChatLine(s);
  assert.equal(line.name, '小志');
  assert.equal(line.text, 'не фидите');
});

ok('no markup left in what gets translated', () => {
  const line = parseMarkupChatLine(MARKUP_ALL);
  assert.ok(!/[<>]/.test(line.text), 'tags survived: ' + line.text);
  assert.ok(!/[<>]/.test(line.name));
});

ok('a string that is not a chat line is not markup either', () => {
  assert.equal(parseMarkupChatLine('<span class="CombatEventGoldIcon" />'), null);
  assert.equal(parseMarkupChatLine('e_dive_corrosive_rope02.vpcf'), null);
  assert.equal(parseMarkupChatLine(PERSONA), null);          // anchor, no name
  assert.equal(parseMarkupChatLine(null), null);
});

ok('both forms of the same line reach readMemoryFindings', () => {
  const { lines } = readMemoryFindings([MARKUP_ALL, '  [Allies] Иван: го мид']);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.channel), ['all', 'team']);
});

ok('a channel we have not named is REPORTED, not silently dropped', () => {
  // The closed tag list fails silently otherwise: a real channel would
  // simply never be translated and nobody would know why.
  assert.equal(unknownChannelTag('[Whisper] Иван: привет'), 'Whisper');
  assert.equal(unknownChannelTag('[Allies] Иван: привет'), null);   // known
  assert.equal(unknownChannelTag('not a line at all'), null);
  const { unknownTags } = readMemoryFindings([
    '[Whisper] a: привет', '[Whisper] b: пока', '[Allies] c: гг',
  ]);
  assert.deepEqual(unknownTags, ['Whisper']);   // once per tag, not per line
});

console.log('memsource');

// A stand-in for the PowerShell helper: events are pushed in by hand, so
// the whole source can be exercised with no Dota and no child process.
function fakeSource(opts = {}) {
  const seen = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.kill = () => {};
  const source = startMemorySource({
    spawnImpl: () => child,
    onMessage: (m) => seen.push(m),
    ...opts,
  });
  const feed = (obj) => {
    const line = obj.t === 'line' && obj.s !== undefined
      ? { t: 'line', b64: Buffer.from(obj.s, 'utf8').toString('base64') }
      : obj;
    child.stdout.emit('data', JSON.stringify(line) + '\n');
  };
  return { source, feed, seen, child };
}

ok('a line event decodes from base64 as UTF-8', () => {
  const s = '  [Allies] Луиза: не фидите';
  const raw = JSON.stringify({ t: 'line', b64: Buffer.from(s, 'utf8').toString('base64') });
  assert.deepEqual(parseEvent(raw), { kind: 'line', text: s });
});

ok('a half-written line on the pipe is not an error', () => {
  assert.equal(parseEvent('{"t":"li'), null);
  assert.equal(parseEvent(''), null);
  assert.equal(parseEvent('   '), null);
  assert.equal(parseEvent('not json'), null);
  assert.equal(parseEvent('{"t":"line"}'), null);       // no payload
});

ok('status and stat events come through', () => {
  assert.deepEqual(parseEvent('{"t":"status","state":"reading","pid":7}'),
    { kind: 'status', state: 'reading', detail: undefined, pid: 7 });
  assert.equal(parseEvent('{"t":"stat","ms":400}').kind, 'stat');
  assert.deepEqual(parseEvent('{"t":"error","detail":"boom"}'), { kind: 'error', detail: 'boom' });
});

ok('the backlog a game already holds is primed past, not announced', () => {
  // Attaching mid-match finds every line said so far. Showing them would
  // dump the whole match onto the overlay the moment you start the app -
  // the same reason LogTail starts at the END of the log.
  const { source, feed, seen } = fakeSource();
  feed({ t: 'status', state: 'reading', pid: 7 });
  feed({ t: 'line', s: '[Allies] Иван: старое сообщение' });   // backlog
  feed({ t: 'stat', full: true, ms: 1 });                       // sweep over
  assert.deepEqual(seen, []);
  feed({ t: 'line', s: '[Allies] Иван: новое сообщение' });     // said now
  assert.deepEqual(seen.map((m) => m.text), ['новое сообщение']);
  source.stop();
});

ok('a new game primes again rather than replaying the last one', () => {
  const { source, feed, seen } = fakeSource();
  feed({ t: 'status', state: 'reading', pid: 7 });
  feed({ t: 'stat', full: true, ms: 1 });
  feed({ t: 'line', s: '[Allies] Иван: первая игра' });
  assert.equal(seen.length, 1);
  feed({ t: 'status', state: 'reading', pid: 8 });              // Dota restarted
  feed({ t: 'line', s: '[Allies] Иван: старое сообщение' });
  feed({ t: 'stat', full: true, ms: 1 });
  assert.equal(seen.length, 1, 'the new match backlog was announced');
  source.stop();
});

ok('a line already in the language the reader speaks is never sent', () => {
  // Dota's own chat wheel is localised per client, so "Pushing mid"
  // arrives in English and a call to translate it would be pure noise.
  const { source, feed, seen } = fakeSource();
  feed({ t: 'status', state: 'reading', pid: 7 });
  feed({ t: 'stat', full: true, ms: 1 });
  feed({ t: 'line', s: '[Allies] Pernille: Pushing mid' });
  feed({ t: 'line', s: '[Allies] Иван: го мид' });
  assert.deepEqual(seen.map((m) => m.text), ['го мид']);
  source.stop();
});

ok('the scanner is run through Windows PowerShell with no profile', () => {
  const args = scannerArgs('S.ps1', { intervalMs: 250, fullRescanMs: 5000 });
  assert.ok(args.includes('-NoProfile'));
  assert.ok(args.includes('-NonInteractive'));
  assert.equal(args[args.indexOf('-File') + 1], 'S.ps1');
  assert.equal(args[args.indexOf('-IntervalMs') + 1], '250');
  assert.equal(POWERSHELL, 'powershell.exe');   // not pwsh: an optional install
});

ok('the scanner is told whose child it is, so it can stop when we are gone', () => {
  // A force-killed parent never calls child.kill(). MEASURED: a scanner
  // given a pid exits within a poll of that process going; one given
  // none was still running ten seconds later.
  const args = scannerArgs('S.ps1');
  assert.equal(args[args.indexOf('-ParentPid') + 1], String(process.pid));
});

ok('window settings reach the scanner only when somebody has set them', () => {
  assert.ok(!scannerArgs('S.ps1').includes('-WindowMb'));
  const args = scannerArgs('S.ps1', { windowMb: 0, wideEvery: 3, processName: 'fakedota' });
  assert.equal(args[args.indexOf('-WindowMb') + 1], '0');     // 0 is a setting, not an absence
  assert.equal(args[args.indexOf('-WideEvery') + 1], '3');
  assert.equal(args[args.indexOf('-ProcessName') + 1], 'fakedota');
});

ok('the chat panel is on unless somebody turns it off', () => {
  assert.ok(!scannerArgs('S.ps1').includes('-Panel'));
  assert.ok(!scannerArgs('S.ps1', { panel: true }).includes('-Panel'));
  const args = scannerArgs('S.ps1', { panel: false, panelIntervalMs: 100 });
  assert.equal(args[args.indexOf('-Panel') + 1], '0');
  assert.equal(args[args.indexOf('-PanelIntervalMs') + 1], '100');
});

ok('the layout says where the chat is and what is stacked in it', () => {
  const ev = parseEvent(JSON.stringify({ t: 'layout', x: 2026, y: 827, s: 1.333, rows: [{ a: 5850418734336, h: 34, w: 696 }, { a: 0, h: 68, w: 1000 }] }));
  assert.equal(ev.kind, 'layout');
  assert.deepEqual([ev.x, ev.y, ev.scale], [2026, 827, 1.333]);
  assert.deepEqual(ev.rows[0], { addr: 5850418734336, height: 34, width: 696 });
  assert.equal(ev.rows[1].addr, 0);            // a row with no chat line in it still takes its place in the stack
  assert.equal(parseEvent(JSON.stringify({ t: 'layout', x: 1, y: 2 })), null);
});

ok('every sighting of a line is reported, even one already shown', () => {
  // The game makes all its chat lines again when it trims them, at new
  // addresses. The tracker drops those as seen - rightly - but the cover
  // has to learn where each line lives now, or it loses every strip at
  // the first trim.
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
  child.kill = () => {};
  const seen = [], said = [];
  const src = startMemorySource({ spawnImpl: () => child, onSeen: (s) => seen.push(s.addr), onMessage: (m) => said.push(m.text) });
  const line = (addr) => JSON.stringify({ t: 'line', a: addr, w: 1, r: 0, rs: 0, ab: 0, p: 1, b64: Buffer.from('[Allies] a: гг', 'utf8').toString('base64') }) + '\n';
  child.stdout.emit('data', JSON.stringify({ t: 'stat', mode: 'panel' }) + '\n');      // priming over
  child.stdout.emit('data', line(100));
  child.stdout.emit('data', line(200));
  src.stop();
  assert.deepEqual(seen, [100, 200]);
  assert.equal(said.length, 1);
});

ok('a line the chat list says was just appended is new, whatever its words', () => {
  // The user pasted the same test line twice and the translator looked
  // dead: the second one was dropped as already shown. Words alone cannot
  // tell a repeat from a re-read; the game's own list of lines can.
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
  child.kill = () => {};
  const said = [];
  const src = startMemorySource({ spawnImpl: () => child, onMessage: (m) => said.push(m.text) });
  const b64 = Buffer.from('[Allies] a: гг', 'utf8').toString('base64');
  const line = (n) => JSON.stringify({ t: 'line', a: 100, w: 1, r: 0, rs: 0, ab: 0, p: 1, n, b64 });
  child.stdout.emit('data', JSON.stringify({ t: 'stat', mode: 'panel' }) + String.fromCharCode(10));
  for (const n of [1, 0, 1]) child.stdout.emit('data', line(n) + String.fromCharCode(10));
  src.stop();
  // said, re-read (dropped), said again (shown)
  assert.equal(said.length, 2);
});

ok('a search for the chat panel is not a stat', () => {
  // A stat says a read is over, and the first one ends priming. A search
  // that arrived as one would end it BEFORE the panel had been read, and
  // the whole match backlog would go up on the overlay as new.
  const ev = parseEvent(JSON.stringify({ t: 'find', panels: 4, ms: 9286, mb: 13350 }));
  assert.deepEqual(ev, { kind: 'find', panels: 4, ms: 9286, mb: 13350 });
});

ok('a line read from the chat panel comes out as the scanner\'s would', () => {
  // Exactly what the panel reader emits for a real all-chat line: the
  // 48 bytes before the anchor, to the end of the string.
  const raw = 'ro_furion.png" /><span class="ChatTarget"> <span class="ChatPersona"><span class="PlayerColor0">' +
    "<font color='#3375FF'>unc status</font></span></span></span>: у кого есть дасты 07331</span>";
  const { lines } = readMemoryFindings([raw]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].channel, 'all');
  assert.equal(lines[0].name, 'unc status');
  assert.equal(lines[0].text, 'у кого есть дасты 07331');
});

ok('a line says where it was found and whether a window covered it', () => {
  const b64 = Buffer.from('[Allies] a: гг', 'utf8').toString('base64');
  const ev = parseEvent(JSON.stringify({ t: 'line', b64, a: 140711718912000, w: 1 }));
  assert.equal(ev.addr, 140711718912000);      // above 2^32, below 2^53: exact
  assert.equal(ev.inWindow, true);
  assert.equal(parseEvent(JSON.stringify({ t: 'line', b64, a: 5, w: 0 })).inWindow, false);
});

ok('a new line is measured against where chat WAS, not against its own second copy', () => {
  // Every line is in memory twice, plain and as markup, a few hundred
  // bytes apart. Measured against this scan's own finds, every line
  // would be "right next to a known hit" and the window would look
  // perfect whatever the truth was.
  assert.equal(nearestDistance(100, []), null);
  assert.equal(nearestDistance(100, [40, 130, 900]), 30);

  const placed = [];
  const { source, feed } = fakeSource({ onPlacement: (p) => placed.push(p) });
  const line = (s, a, w) => feed({ t: 'line', b64: Buffer.from(s, 'utf8').toString('base64'), a, w });
  feed({ t: 'status', state: 'reading', pid: 7 });
  line('[Allies] Иван: старое', 1000, 0);                        // backlog
  feed({ t: 'stat', full: true, mode: 'full', ms: 1 });
  assert.deepEqual(placed, [], 'the backlog is not a placement');

  line('[Allies] Иван: далеко', 9000, 0);
  line('[Allies] Иван: далеко', 9300, 0);                        // its second copy
  assert.deepEqual(placed, [], 'a placement waits for its scan to end');
  feed({ t: 'stat', full: false, mode: 'wide', ms: 1 });
  assert.deepEqual(placed, [{ inWindow: false, distance: 8000, channel: 'team', text: 'далеко', mode: 'wide' }]);

  line('[Allies] Pernille: Pushing mid', 9400, 1);               // English counts too
  feed({ t: 'stat', full: false, mode: 'win', ms: 1 });
  assert.deepEqual(placed[1], { inWindow: true, distance: 100, channel: 'team', text: 'Pushing mid', mode: 'win' });
  source.stop();
});

ok('a placement carries the region and allocation the line was in', () => {
  // An address alone cannot say whether two lines shared a region or a
  // heap, and that is the question all chat has left open.
  const placed = [];
  const { source, feed } = fakeSource({ onPlacement: (p) => placed.push(p) });
  feed({ t: 'status', state: 'reading', pid: 7 });
  feed({ t: 'stat', full: true, mode: 'full', ms: 1 });
  feed({ t: 'line', b64: Buffer.from('[Allies] Иван: гг', 'utf8').toString('base64'), a: 5000, w: 0, r: 4096, rs: 8192, ab: 4096 });
  feed({ t: 'stat', full: false, mode: 'wide', ms: 1 });
  assert.deepEqual(placed, [{
    inWindow: false, distance: null, channel: 'team', text: 'гг', addr: 5000, region: 4096, regionSize: 8192, alloc: 4096, mode: 'wide',
  }]);
  source.stop();
});

await okAsync('the first try is given seconds, not twelve, and the second is given longer', async () => {
  // MEASURED: a call answers in about a second or never. Waiting 12s to
  // learn which put a line up 14 seconds after it was said.
  const given = [];
  const hangsOnce = async (url, init) => {
    given.push(init.signal);
    if (given.length === 1) { const e = new Error('x'); e.name = 'AbortError'; throw e; }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"i":0,"en":"gg"}]' }] } }] }) };
  };
  assert.ok(HEDGE_AFTER_MS <= 1500 && ATTEMPT_MS > HEDGE_AFTER_MS);
  const rows = await translateBatch([{ name: 'A', text: 'гг' }], { apiKey: 'k', fetchImpl: hangsOnce });
  assert.equal(given.length, 2);
  assert.equal(rows[0].en, 'gg');
});

ok('windows have defaults, and a config can turn them off', () => {
  assert.equal(mergeConfig({}).scanWindowMb, 4);
  assert.equal(mergeConfig({}).scanWideEvery, 5);
  assert.equal(mergeConfig({ scanWindowMb: 0 }).scanWindowMb, 0);
});

await okAsync('a call that never arrived is made once more, an answered one is not', async () => {
  // The first live game this ever read timed out on one of its two
  // lines, so this is the common case, not the rare one.
  let tries = 0;
  const flaky = async () => {
    tries++;
    if (tries === 1) { const e = new Error('boom'); e.name = 'AbortError'; throw e; }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[{"i":0,"en":"go mid"}]' }] } }] }) };
  };
  const rows = await translateBatch([{ name: 'A', text: 'иди мид' }], { apiKey: 'k', fetchImpl: flaky, timeoutMs: 5 });
  assert.equal(tries, 2, 'the timed-out call was not tried again');
  assert.equal(rows[0].en, 'go mid');
  assert.equal(rows[0].translated, true);
});

await okAsync('a call that hangs is raced, not waited for', async () => {
  // The live game lost one line's call on both of its tries and showed it
  // untranslated 10.6s late. A second call beside a silent first one is
  // an answer in about a second.
  let asked = 0;
  const ask = () => {
    asked++;
    if (asked === 1) return new Promise(() => {});          // never answers
    return Promise.resolve('[{"i":0,"en":"gg"}]');
  };
  const t0 = Date.now();
  const text = await askGeminiHedged({}, { hedgeAfterMs: 20, ask });
  assert.equal(text, '[{"i":0,"en":"gg"}]');
  assert.equal(asked, 2);
  assert.ok(Date.now() - t0 < 500, 'the hedge waited for the hung call');
});

await okAsync('every attempt lost is an error, and no more than three are made', async () => {
  let asked = 0;
  const ask = async () => { asked++; throw new Error('could not reach the model'); };
  await assert.rejects(() => askGeminiHedged({}, { hedgeAfterMs: 5, ask }), /could not reach/);
  assert.equal(asked, 3);
});

await okAsync('a line is shown at once and its English fills the same row', async () => {
  // memwatcher's contract with the chat box: pending first, then a result
  // with the SAME id; a repeat comes from the cache with no call at all.
  const { startWatchingMemory } = await import('./src/memwatcher.js');
  let say = null, calls = 0;
  const events = [];
  const w = startWatchingMemory({ ...mergeConfig({}), batchMs: 1 }, {
    startSource: (opts) => { say = opts.onMessage; return { stop() {} }; },
    translate: async (batch) => { calls++; return batch.map((b) => ({ ...b, en: 'go mid', translated: true })); },
    onPending: (row) => events.push(['pending', row.id, row.text]),
    onResult: (row) => events.push(['line', row.id, row.en, Boolean(row.cached)]),
  });
  say({ name: 'A', text: 'иди мид', channel: 'team', slot: 2 });
  await tick(30);
  say({ name: 'B', text: 'иди мид', channel: 'all', slot: 3 });
  await tick(10);
  w.stop();
  assert.deepEqual(events, [['pending', 1, 'иди мид'], ['line', 1, 'go mid', false], ['line', 2, 'go mid', true]]);
  assert.equal(calls, 1, 'the repeat cost a call');
});

await okAsync('a reply whose body never arrives is timed out like one that never came', async () => {
  // Headers, then silence. The clock used to stop at the headers.
  const stalls = async (url, init) => ({
    ok: true,
    json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; reject(e); })),
  });
  const { askGemini } = await import('./src/translate.js');
  await assert.rejects(() => askGemini({ apiKey: 'k', request: {}, fetchImpl: stalls, timeoutMs: 20 }), /took too long/);
});

await okAsync('a call that never settles does not keep its place in the pipeline', async () => {
  // Three of these used to be the end of translation for the match.
  const out = [];
  let calls = 0;
  const pipe = createPipeline({
    batchMs: 1, maxInFlight: 1, callTimeoutMs: 30,
    translate: (batch) => (++calls === 1 ? new Promise(() => {}) : Promise.resolve(batch.map((b) => ({ ...b, en: 'ok', translated: true })))),
    onResult: (row) => out.push([row.text, row.translated]),
  });
  pipe.push({ name: 'a', text: 'one' });
  await tick(10);
  pipe.push({ name: 'a', text: 'two' });
  await tick(120);
  pipe.stop();
  assert.deepEqual(out, [['one', false], ['two', true]]);
});

await okAsync('as the minute is spent calls are spaced out and lines share them', async () => {
  // The free tier is 15 calls a minute and it was run into. The limit is
  // per CALL, so the answer is fewer, fuller calls - not fewer lines.
  let clock = 1000000;
  const batches = [], hedges = [], out = [];
  const pipe = createPipeline({
    batchMs: 1, callsPerMinute: 5, now: () => clock,        // a budget of 4: two at once, two paced
    translate: async (batch, { hedge }) => { batches.push(batch.length); hedges.push(hedge); return batch.map((b) => ({ ...b, en: 'EN', translated: true })); },
    onResult: (row) => out.push(row.text),
  });
  pipe.push({ text: 'a' }); await tick(15);
  pipe.push({ text: 'b' }); await tick(15);
  assert.deepEqual(batches, [1, 1]);
  // Half the budget has gone: these wait for their turn, together.
  for (const t of ['c', 'd', 'e']) pipe.push({ text: t });
  await tick(80);
  assert.deepEqual(batches, [1, 1], 'a call was made with no spacing');
  clock += 5000; await tick(200);                           // not their turn yet: 60s / 2 left = 30s apart
  assert.deepEqual(batches, [1, 1]);
  clock += 3000;                                            // 8s: not yet too late to be worth translating
  await tick(200);
  assert.equal(pipe.pending, 3);
  pipe.stop();
  assert.deepEqual(hedges, [true, true]);
});

await okAsync('when their turn comes, everything that waited goes in one call, unhedged', async () => {
  let clock = 1000000;
  const batches = [], hedges = [];
  const pipe = createPipeline({
    batchMs: 1, callsPerMinute: 5, maxWaitMs: 40000, now: () => clock,
    translate: async (batch, { hedge }) => { batches.push(batch.length); hedges.push(hedge); return batch.map((b) => ({ ...b, en: 'EN', translated: true })); },
    onResult: () => {},
  });
  pipe.push({ text: 'a' }); await tick(15);
  pipe.push({ text: 'b' }); await tick(15);
  for (const t of ['c', 'd', 'e']) pipe.push({ text: t });
  await tick(30);
  clock += 31000; await tick(1100);
  pipe.stop();
  assert.deepEqual(batches, [1, 1, 3]);
  assert.equal(hedges[2], false, 'a second request was allowed with half the budget gone');
});

await okAsync('a line that has waited too long for the limit is shown as it was said', async () => {
  let clock = 1000000;
  const out = [];
  const pipe = createPipeline({
    batchMs: 1, callsPerMinute: 2, maxWaitMs: 10000, now: () => clock,
    translate: async (batch) => batch.map((b) => ({ ...b, en: 'EN', translated: true })),
    onResult: (row) => out.push([row.text, row.translated]),
  });
  pipe.push({ text: 'a' }); await tick(20);
  pipe.push({ text: 'late' }); await tick(20);
  clock += 11000;
  await tick(1100);
  pipe.stop();
  assert.deepEqual(out, [['a', true], ['late', false]]);
});

await okAsync('a refusal is the answer and is not asked twice', async () => {
  let tries = 0;
  const refuses = async () => {
    tries++;
    return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) };
  };
  await assert.rejects(() => translateBatch([{ name: 'A', text: 'иди мид' }], { apiKey: 'k', fetchImpl: refuses }));
  assert.equal(tries, 1, 'a quota answer was asked for twice');
});

console.log('build');

ok('the scanner script parses', () => {
  // The whole chat source is ONE PowerShell file, and nothing else in
  // this repo would notice it being broken: a syntax error there is not
  // an error anybody sees, it is a tool that silently never reads a line.
  // Skipped where PowerShell is not the shell - the tool is Windows-only,
  // but the rest of the suite need not be.
  const check = (file) => {
    const script = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$null,[ref]$e); if($e.Count){ $e | ForEach-Object { $_.ToString() }; exit 1 }`;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', stdio: 'pipe' });
      return '';
    } catch (err) {
      if (err.code === 'ENOENT') return null;          // no PowerShell here
      return String(err.stdout || err.message).trim() || 'parse failed';
    }
  };

  // The rig's scripts too: one of them broken costs a live session.
  const files = ['src', 'tools'].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.ps1')).map((f) => path.join(d, f)));
  assert.ok(files.length >= 4, 'expected the scanner and the rig, got ' + files.length);

  // A checker that always says yes says nothing, so it is asked about a
  // script that is definitely broken before it is believed about ours.
  const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ps-')), 'broken.ps1');
  fs.writeFileSync(broken, 'if ($true) { "unclosed');
  const control = check(broken);
  if (control === null) return;                        // not Windows: nothing to say
  assert.notEqual(control, '', 'the parse check passed a broken script');

  for (const f of files) assert.equal(check(f), '', f + ' does not parse');

  // And none holds a NUL or anything that is not ASCII. Both have
  // happened, both PARSE, and both are invisible: a "\0" that went
  // through a shell on its way into a patch arrived as a real NUL inside
  // a C# string, and Cyrillic in a script with no BOM is read as ANSI, so
  // the stand-in spoke mojibake and the reader rightly ignored it.
  // Comments may show what mojibake looks like; code may not contain any.
  for (const f of files) {
    const lines = fs.readFileSync(f, 'latin1').split('\n');
    const bad = lines.findIndex((l) => !/^\s*(#|\/\/)/.test(l) && /[^\t\r\x20-\x7e]/.test(l));
    assert.equal(bad, -1, `${f}:${bad + 1} has a byte that is not plain ASCII, outside a comment`);
  }
});

ok('every script parses', () => {
  const files = fs.readdirSync('src').filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));
  assert.ok(files.length >= 7, 'expected the whole src folder, got ' + files.length);
  for (const f of files) execFileSync(process.execPath, ['--check', path.join('src', f)]);
  // The stand-in game too: it is what the reader is tested against
  // before the live game is, so it being broken costs a live session.
  for (const f of fs.readdirSync('tools').filter((x) => /\.m?js$/.test(x))) execFileSync(process.execPath, ['--check', path.join('tools', f)]);
});

console.log('\n' + passed + ' passed');
