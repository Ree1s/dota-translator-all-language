// Between the log and the screen: gather the lines that arrive together
// into one call, keep the order, and never let a failed translation take
// the line with it.

export function createPipeline({ translate, onResult, onError = () => {}, batchMs = 400, maxBatch = 12, maxInFlight = 3, callTimeoutMs = 12000 }) {
  let queue = [];
  let timer = null;
  let due = 0;
  // How many calls are out. It was one at a time, and MEASURED a call is
  // either quick (0.7-1.0s) or lost (2.5s, then a retry of up to 8s): one
  // lost call held every line said after it for ten seconds. Rows carry
  // an id, and the chat box fills each in where it already stands, so
  // answers arriving out of order cost nothing.
  let running = 0;

  async function flush() {
    timer = null;
    due = 0;
    if (running >= maxInFlight || !queue.length) return;
    const batch = queue.slice(0, maxBatch);
    queue = queue.slice(maxBatch);
    running++;
    try {
      // And a last line of defence here, because a call that never settles
      // takes one of the three places for the rest of the match.
      let watchdog;
      const out = await Promise.race([
        translate(batch),
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
    const at = Date.now() + ms;
    if (timer && due <= at) return;
    if (timer) clearTimeout(timer);
    due = at;
    timer = setTimeout(flush, ms);
  }

  return {
    push(msg) {
      queue.push(msg);
      schedule(queue.length >= maxBatch ? 0 : batchMs);
    },
    get pending() { return queue.length; },
    stop() { if (timer) clearTimeout(timer); timer = null; due = 0; queue = []; },
  };
}
