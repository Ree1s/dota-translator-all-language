// Where the game's chat is, from the game WINDOW's place and size alone.
//
// The memory reader was told by the game (HudChat's position and the UI
// scale). GSI mode reads no memory, so it works it out: Dota lays its HUD
// out in 1080-high units around the picture's centre line, and the chat
// does not move.
//
// MEASURED, one screen (5120x1440, scale 1.33): the game said HudChat was at
// (2026, 827). That is 400.5 units LEFT of the centre line and 620.25 units
// down, and it agrees with the chat-row portrait found by screenshot for the
// row grab (-362.25 from the centre = HudChat + 31.5 + 6.25). At 1920x1080
// the game reported scale 1.0 and rows 25 high, 34 at 1.33: 25.5 units.
// NOT seen: 16:10 and 4:3 (the game may scale by width there), a HUD-scale
// setting, a borderless game rendering below the desktop's resolution.

const CHAT_FROM_CENTRE = -400.5;
const CHAT_DOWN = 620.25;
const ROW_HIGH = 25.5;

// { x, y, w, h } of the window's client area in screen pixels -> the same
// shape the memory helper's `layout` event has, or null for a window that is
// no game picture (minimised, a splash).
export function layoutFromWindow(win) {
  if (!win || ![win.x, win.y, win.w, win.h].every(Number.isFinite)) return null;
  if (win.w < 640 || win.h < 480) return null;
  const scale = win.h / 1080;
  return {
    x: Math.round(win.x + win.w / 2 + CHAT_FROM_CENTRE * scale),
    y: Math.round(win.y + CHAT_DOWN * scale),
    scale,
    // No real rows are known; one stand-in gives the overlay the row pitch.
    rows: [{ addr: 0, height: Math.floor(ROW_HIGH * scale), width: 0 }],
  };
}
