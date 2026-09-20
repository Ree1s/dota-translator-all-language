// A stand-in for the game, for testing the memory reader with no Dota.
//
//   copy node.exe to fakedota.exe, then:  fakedota.exe tools/fakedota.js
//   and point the scanner at it:          -ProcessName fakedota
//
// It holds chat lines VERBATIM, in both of the forms Dota keeps them in,
// inside one 48 MB buffer (one allocation, under the scanner's 64 MB poll
// cap), and says a new one every few seconds - alternately NEAR the last
// line and FAR from every line so far, so a windowed poll and a wide poll
// each have something only they can find.
//
// It also runs a "frame": a fixed memory-heavy piece of work, timed. That
// is a PROXY for what the reader costs a game - the same workload slows
// down when something else is taking memory bandwidth or its core - and
// it is only a proxy. The measurement that decides anything is frame time
// in the real game.
//
//   --ballast <MB>   extra private memory for a sweep to chew on (default 256)
//   --every <ms>     how often a new line is said (default 3000)
//   --no-frames      do not run the frame workload

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : Number(process.argv[i + 1]);
};
const BALLAST_MB = arg('--ballast', 256);
const EVERY_MS = arg('--every', 3000);
const FRAMES = !process.argv.includes('--no-frames');
const MB = 1024 * 1024;

// Filled, not zeroed: a zero page is not really there until it is touched.
function filled(bytes) {
  const b = Buffer.allocUnsafeSlow(bytes);
  for (let i = 0; i < bytes; i += 4096) b.writeUInt32LE((i * 2654435761) >>> 0, i);
  return b;
}

const ballast = [];
for (let i = 0; i < BALLAST_MB / 32; i++) ballast.push(filled(32 * MB));

const chat = filled(48 * MB);
let nearAt = 1 * MB;       // where the next NEAR line goes
let farAt = 40 * MB;       // where the next FAR line goes; steps down 6 MB a time

// Written straight into the buffer. Going through Buffer.from() left a
// second UTF-8 copy of every line in node's own buffer pool, right beside
// the last one, so every "far" line was also found near.
function put(at, text) {
  chat.fill(0, at - 1, at);              // a terminator before it, as a heap would have
  const len = chat.write(text, at, 'utf8');
  chat.fill(0, at + len, at + len + 1);
  return len + 1;
}

const markup = (tag, slot, name, text) =>
  'hero_juggernaut.png" /><span class="ChatTarget">' + tag +
  '<span class="ChatPersona"><span class="PlayerColor' + slot + '">' +
  "<font color='#FF6B00'>" + name + '</font></span></span>: ' + text;

function say(where, team, name, text) {
  const tag = team ? '[Allies] ' : '';
  let at = where === 'near' ? nearAt : farAt;
  at += put(at, tag + name + ': ' + text) + 64;
  at += put(at, markup(tag, 4, name, text)) + 64;
  if (where === 'near') nearAt = at + 4096; else farAt -= 6 * MB;
  // Not the text: printing it puts a UTF-8 copy of the line in a pipe
  // buffer, which is one more place for the scanner to find it.
  console.log('[said ' + where + '] #' + (text.match(/[0-9]+$/) || ['backlog'])[0]);
}

// The backlog: what had been said before anybody started listening.
say('near', true, 'Иван', 'старое сообщение');
say('near', false, 'Луиза', 'привет всем');

const LINES = [
  ['near', true, 'Иван', 'иди мид'],
  ['far', false, 'Луиза', 'я иду топ, помогите'],
  ['near', true, 'Pernille', 'Pushing mid'],
  ['far', true, 'Иван', 'давай рошан'],
  ['near', false, 'Луиза', 'не фидите, у них варды на руне'],
  ['far', true, 'Иван', 'гг вп'],
];
let n = 0;
setInterval(() => {
  const [where, team, name, text] = LINES[n % LINES.length];
  // A counter, because the reader dedups by content and would otherwise
  // hear each of these exactly once.
  if (farAt > 8 * MB || where === 'near') say(where, team, name, text + ' ' + (++n));
  else n++;
}, EVERY_MS);

if (FRAMES) {
  const src = filled(16 * MB), dst = Buffer.allocUnsafeSlow(16 * MB);
  let times = [];
  let since = process.hrtime.bigint();
  const frame = () => {
    const t0 = process.hrtime.bigint();
    src.copy(dst); dst.copy(src);
    const t1 = process.hrtime.bigint();
    times.push(Number(t1 - t0) / 1e6);
    if (t1 - since > 5000000000n) {
      times.sort((a, b) => a - b);
      const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(2);
      console.log(`[frames] n=${times.length} p50=${q(0.5)}ms p95=${q(0.95)}ms p99=${q(0.99)}ms max=${q(1)}ms`);
      times = []; since = t1;
    }
    setImmediate(frame);
  };
  frame();
}

console.log(`[fakedota] pid ${process.pid}, ${BALLAST_MB} MB ballast, a line every ${EVERY_MS}ms`);

// The ballast is touched now and then, or V8 notices nothing reads it and
// gives a gigabyte back - MEASURED: a sweep of a "1 GB" stand-in read 246 MB.
setInterval(() => { for (const b of ballast) b[0] ^= 1; }, 10000);
