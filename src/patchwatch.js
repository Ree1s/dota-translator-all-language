// Notices that the fast chat reader is not working on this Dota build, so
// that the app can SAY so. Until this existed, a patch that moved the chat
// offsets made the app quietly worse - lines seconds late, the dark box, no
// portraits - and the player could only conclude it was broken.
//
// What it goes on: every search for the chat panel is reported (`find`,
// with how many panels validated). A healthy game always has some - the
// menu's exist before any match does - so searches that keep finding NONE,
// in a game where none was ever found, mean the offsets no longer fit. One
// empty search is not enough: the first can land while Dota is still
// starting. Finding any panel later takes it back.
export function createPatchWatch({ onSlow = () => {}, onFast = () => {}, after = 2 } = {}) {
  let empty = 0, everFound = false, slow = false;
  return {
    find(panels) {
      if (panels > 0) {
        everFound = true; empty = 0;
        if (slow) { slow = false; onFast(); }
        return;
      }
      // Panels that were there and have gone are a match ending, not a patch.
      if (everFound || slow) return;
      if (++empty >= after) { slow = true; onSlow(); }
    },
    // A new game process (Dota restarted, perhaps just patched) starts again.
    reset() { empty = 0; everFound = false; if (slow) { slow = false; onFast(); } },
    get slow() { return slow; },
  };
}

export const SLOW_TEXT = 'Dota was updated and the fast chat reader does not fit it yet - running in slow mode until the fix arrives. Nothing to do: it is fetched by itself.';
