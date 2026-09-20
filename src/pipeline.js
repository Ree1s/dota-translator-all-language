// Between the log and the screen: gather the lines that arrive together
// into one call, keep the order, and never let a failed translation take
// the line with it.

export function createPipeline({ translate, onResult, onError = () => {}, batchMs = 400, maxBatch = 12 }) {
  let queue = [];
  let timer = null;
  let due = 0;
  let running = false;

  async function flush() {
    timer = null;
    due = 0;
    if (running || !queue.length) return;
    const batch = queue.slice(0, maxBatch);
    queue = queue.slice(maxBatch);
    running = true;
    try {
      const out = await translate(batch);
      for (const row of out) onResult(row);
    } catch (err) {
      onError(err);
      // The model is not the point of failure the player should pay for:
      // show what was said, untranslated, rather than nothing.
      for (const it of batch) onResult({ ...it, en: it.text, translated: false, error: String(err && err.message || err) });
    } finally {
      running = false;
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
