// Between the log and the screen: gather the lines that arrive together
// into one call, keep the order, and never let a failed translation take
// the line with it.
//
// And stay inside the model's RATE LIMIT, which is per CALL, not per line.
// MEASURED the hard way: the free tier of gemini-3.5-flash-lite allows 15
// calls a minute, a test that doubled the load ran into it, and five lines
// in a row went up untranslated with "quota exceeded". A line per call is
// the quickest way to translate a quiet chat and the quickest way to run
// out in a loud one, so the gather window is not fixed: while the minute's
// budget is mostly unspent a line goes almost at once, and as it is spent
// lines wait longer and SHARE a call - twelve lines cost what one does.
// When it is all spent, lines wait for the first call to age out of the
// minute, and one that has waited too long to be worth reading late is
// shown as it was said.

export function createPipeline({
  translate, onResult, onError = () => {},
  batchMs = 400, maxBatch = 12, maxInFlight = 3, callTimeoutMs = 12000,
  callsPerMinute = 15, maxWaitMs = 10000,
  now = Date.now,
}) {
  let queue = [];            // { msg, at }
  let timer = null;
  let due = 0;
  // How many calls are out. It was one at a time, and MEASURED a call is
  // either quick (0.7-1.0s) or lost: one lost call held every line said
  // after it. Rows carry an id, and the chat box fills each in where it
  // already stands, so answers arriving out of order cost nothing.
  let running = 0;
  let calls = [];            // when each call of the last minute was made

  // One is kept back: a hedged call can cost a second request.
  const budget = Math.max(1, callsPerMinute - 1);
  function spent() {
    const from = now() - 60000;
    calls = calls.filter((t) => t > from);
    return calls.length;
  }

  function giveUpOnTheOld() {
    const tooOld = now() - maxWaitMs;
    const late = queue.filter((q) => q.at <= tooOld);
    if (!late.length) return;
    queue = queue.filter((q) => q.at > tooOld);
    for (const q of late) onResult({ ...q.msg, en: q.msg.text, translated: false, error: 'rate limit: too late to translate' });
  }

  async function flush() {
    timer = null;
    due = 0;
    if (!queue.length) return;
    if (running >= maxInFlight) return;               // the call that finishes will come back here
    const used = spent();
    const wait = waitNeeded(used);
    if (wait > 0) {
      giveUpOnTheOld();
      if (queue.length) schedule(Math.max(50, Math.min(1000, wait)));
      return;
    }
    const batch = queue.slice(0, maxBatch).map((q) => q.msg);
    queue = queue.slice(maxBatch);
    running++;
    calls.push(now());
    try {
      // A last line of defence, because a call that never settles takes
      // one of the places for the rest of the match. And no hedging once
      // half the budget has gone: a second request is a second call.
      let watchdog;
      const out = await Promise.race([
        translate(batch, { hedge: used < budget / 2 }),
        new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('the model never answered')), callTimeoutMs); }),
      ]).finally(() => clearTimeout(watchdog));
      for (const row of out) onResult(row);
    } catch (err) {
      onError(err);
      // The model is not the point of failure the player should pay for:
      // show what was said, untranslated, rather than nothing.
      for (const it of batch) onResult({ ...it, en: it.text, translated: false, error: String(err && err.message || err) });
    } finally {
      running--;
      if (queue.length) schedule(0);
    }
  }

  // A sooner deadline REPLACES a pending one. A full batch asks for 0
  // while the gather timer is still running, and leaving that timer in
  // place would hold a finished batch for the rest of the window.
  function schedule(ms) {
    const at = now() + ms;
    if (timer && due <= at) return;
    if (timer) clearTimeout(timer);
    due = at;
    timer = setTimeout(flush, ms);
  }

  // How long before another call may be made. Nothing while the minute's
  // calls are mostly unspent - that half is the allowance for a fight.
  // After it, calls are SPACED so that what is left lasts until the oldest
  // call ages out of the minute, and everything said in between shares the
  // next one. MEASURED without this: a line every 2.2s got a call each,
  // fourteen were gone in half a minute, and the next six lines waited out
  // the clock and went up untranslated.
  function waitNeeded(used) {
    if (used < budget / 2) return 0;
    const refill = calls[0] + 60000 - now();
    if (used >= budget) return refill;
    const spacing = refill / (budget - used);
    return Math.max(0, Math.round(calls[calls.length - 1] + spacing - now()));
  }

  return {
    push(msg) {
      queue.push({ msg, at: now() });
      schedule(queue.length >= maxBatch ? 0 : batchMs);
    },
    get pending() { return queue.length; },
    get callsThisMinute() { return spent(); },
    stop() { if (timer) clearTimeout(timer); timer = null; due = 0; queue = []; },
  };
}
