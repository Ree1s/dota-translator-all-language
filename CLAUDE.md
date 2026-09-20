# Dota Translator

Translates Russian Dota 2 chat into English, live, on a transparent
Electron overlay above the game. Free for players, source available,
runs on the player's own Gemini key. Windows only.

The user plays EU servers with Russian teammates who will not or cannot
use English. That is the whole point of it.

---

# WHERE THIS STANDS (2026-09-20, night)

**It works end to end.** In a live bot match, Russian typed into chat was
read out of the game's memory and translated in the terminal, and the
overlay drew it over the game. Nothing about the *approach* is unproven
any more.

```
[17:26:52] [team] unc status: let's do roshan
                              давай рошан
[17:27:08] [all]  unc status: я иду топ, помогите
```

Team chat and all chat both read, both channels right, the match backlog
primed away rather than dumped on screen. The second line went up
untranslated - that was a model call that timed out, which is what the
retry described below is for.

**And since 2026-09-20 (late) it reads the chat's own CONTAINER**, not
the process: a few KB four times a second instead of 340-490 MB every
second. In a bot match, lines typed by the rig at known times:

| | found | say -> found | read per poll |
|---|---|---|---|
| scanning, best configuration | 10/10 | median 1.3-2.7s, worst 7.3-23s | 340-490 MB, plus a 1-2.8 GB wide poll |
| **the chat panel** | **12/12** | **60-290ms, median ~200ms** | **~1 KB idle, ~3 KB with a new line, 0ms** |

Team and all chat alike. The price is one search for the panel per match
(two sweeps of private memory: 9.0-13.0s, 13.3 GB, two threads,
BelowNormal), and fragility: seven hard-coded offsets. The scanner is
still there underneath and takes over by itself when the panel cannot be
found or stops validating. Details under "THE CONTAINER" below.

**And the whole chain, reader + model + chat box, MEASURED end to end
(`tools/e2e.mjs`, two bot matches, 2026-09-20 19:11 and 19:22):**

| | lines | said -> SHOWN in the box | said -> ENGLISH |
|---|---|---|---|
| match 1, calls one at a time, retry after 2.5s | 9/9 | median 196ms, worst 294ms | median 1216ms, worst 1381ms |
| match 2, three calls at once, hedged | 15/15 | median 187ms, worst 295ms | median 1114ms, worst 1337ms |

- **A line is shown TWICE**: at once as `pending` (as said, dimmed,
  italic), then the English replaces it in the same row, by `id`. The
  reader is 0.2s and the model 1s, so this is what makes the box keep
  pace with the game. `memwatcher` gives every line an id; the pipeline
  carries it through; `overlay.js` swaps the row.
- **Calls run three at a time and a slow one is RACED, not retried**
  (`askGeminiHedged`: a second identical call after 1.3s, a third after
  2.6s, first answer wins). Why: in the overlay's first live run one
  line lost BOTH tries and went up untranslated at +10.6s. With one call
  at a time that would also have held every line behind it; it did not,
  the other three came through in ~1s each while it hung.
- **THE FREE TIER IS 15 CALLS A MINUTE, and it was run into (20:18).**
  `generate_content_free_tier_requests, limit: 15, model:
  gemini-3.5-flash-lite` - five lines in a row "quota exceeded" and up
  untranslated. That run doubled the load (the overlay and `e2e.mjs` were
  both translating the same lines), but a line per call plus hedging
  gets there alone in a loud game. The limit is per CALL, so the pipeline
  now governs calls, not lines (`callsPerMinute`, default 15, one kept
  back): the first half of the minute's budget is spent at once - that is
  the allowance for a fight - and after it calls are SPACED so the rest
  lasts until the oldest call ages out, everything said in between
  sharing the next call, unhedged. A line that has waited 10s is shown as
  said. MEASURED, 21 lines in 45s, one consumer:

  | | translated | say -> English |
  |---|---|---|
  | gather window widened with use (first attempt) | 15/21, six lost to the clock | 1.0-2.3s, then 10-11s and untranslated |
  | calls paced once half the budget is spent | **21/21**, no quota error | first 7: 0.9-1.3s; then 1.4-6.7s, median 2.2s |

  Do not run `e2e.mjs` with the overlay up: two consumers, one key.
- **A repeat is answered from a cache** (text -> English, 500 entries):
  55ms and 283ms measured, no call.
- **The chat box** (`overlay.html/js`): one dark panel, `[Allies]`/`[All]`,
  names in Dota's slot colours (dark ones lifted to be readable), original
  beneath. `position: "chat"` (default) puts it directly above the game's
  own chat, growing upwards. MEASURED on 5120x1440: Dota lays its HUD out
  in a centred 16:9 area; chat starts 0.31 across that area, 0.64-0.70
  down the screen. **NOT checked at 16:9/16:10/4:3 or with a flipped HUD**
  - `boxX`/`boxY`/`boxWidth` are the escape. Seen over the game by
  screenshot (`CopyFromScreen` does capture it), aligned with the game's
  chat; nobody has PLAYED with it there.
- **Cost, MEASURED** (12s windows, share of ONE core): idle with a panel
  found - overlay 0.0-1.0%, reader **0.3%** (it was 3.3% until the helper
  stopped calling `Get-Process -Name` every poll: that walks every
  process on the machine, and the reads themselves were "0ms"). Four
  lines in 10s - overlay 5.8%, reader 0.2%. Electron holds ~315-340 MB.
  Scanning was 46-63% of a core.
- **The match boundary, SEEN once:** the bot match ended while testing.
  On the dashboard there were 3 panels, not 4 - the HUD's was gone - and
  the next match had new addresses for all of DotaHud's. So panels are
  per match, as assumed. What was NOT seen is the reader living THROUGH
  it: each time it was a fresh start that found 3 panels within 8.6-12.8s.
- **`saychat.ps1` types wherever Dota is.** After the match ended, 15
  test lines went into the DASHBOARD's party chat (a party of one, so to
  nobody). It cannot tell a match from a menu. Look at the screen first.
- `DT_DEBUG=1 npm start` prints every row sent to the chat box.

**ABOVE MODE is the DEFAULT now (`display: "above"`, 2026-09-20 20:05).**
The user watched cover mode on their own chat and said overlapping was
"maybe not the best idea ... your choice". The choice: the same lines as
BARE OUTLINED TEXT (no panel - the user had asked for no black box, and
with nothing of the game's underneath none is needed), in a window that
ENDS where the game's chat window BEGINS: one chat-height (162 units =
the 216px the game shows, six lines, also when the chat is opened) above
the newest line. Placed from the game's own HudChat position and scale,
as cover is, so there is still nothing to position. Text starts where the
game's text starts; rows use the game's own row pitch. A line shows at
once, as said, italic, and turns into `english (original)`.

- SEEN over the live match in two screenshots 2s apart: three lines, the
  third still pending in the first and English in the second. Row spacing
  was a third too loose (a height already in screen pixels was scaled
  again); fixed after the screenshots and NOT seen since.
- **The font is the game's own, from the game's own folder.** The user
  said the fonts did not match: Dota's chat is Valve's Radiance, which
  exists only inside the install (`game/dota/panorama/fonts/radiance-*.otf`).
  The helper reports the exe path with its `attached` status, `main.js`
  derives the fonts folder and the renderer adds `@font-face` rules for
  it. NEVER copy those files into the repo. SEEN: third screenshot, same
  face as the game's lines below it, rows at the game's pitch. In this
  mode all chat carries no tag and names use Dota's exact slot colours,
  as the game does (the last of these changed after the screenshot).
- **"It worked at start, then stopped" (the user, 20:08). What was found,
  and what was NOT:**
  - The app had not stopped: Electron and its reader were alive, the
    window came back visible and topmost when Dota was brought to the
    front, and a line typed then was translated on screen.
  - **The likely cause is that the user re-pasted the same test lines.**
    A line whose words had been shown before was dropped, by design, and
    "gg" twice was one "gg". FIXED with the chat list itself: a child
    APPENDED to the end of the panel's array since the last poll is new
    whatever it says (the helper sends `n:1`, `memsource` lets it past
    the tracker). After a trim nothing can be told apart, EXCEPT that the
    newest line is still new if it is not the line that was newest
    before - which matters, because a trim usually arrives WITH the line
    that caused it, and a repeated line was lost exactly so. SEEN: the
    same line twice, 4s apart, delivered twice. The trim case is NOT seen.
  - **A WRONG DIAGNOSIS, written down so it is not believed later:** for
    ten minutes the log seemed to show translations never coming back,
    and that was reported to the user as a hang in the model call. They
    were coming back. The grep was for `"line"` in quotes and the debug
    log prints `line {` without them. Check the filter against a line
    known to be there before believing an absence.
  - What that goose chase left behind is still right and is tested: the
    model call's clock now runs until the BODY is read (it stopped at the
    headers, so a stalled body would have been waited for for ever), the
    hedge has an overall deadline, and the pipeline gives a call 12s
    before taking its place back. No hang was ever actually observed.
- **The colours were dimmer than the game's (the user, v0.2.6), white and
  names alike.** Two causes: `opacity` (0.92) was set on the BODY, so it
  dimmed everything in every mode, and the text was the box's off-white
  `#e8e6df`. From v0.2.7 `opacity` is the dark box's only, and bare text
  is `#fff` at full opacity with the exact slot colours. NOT seen over
  the game since; if it still looks dull, the game may draw its chat
  brighter than sRGB white on an HDR screen, which a window cannot match.
- The setup window's key guide opens the LIVE page
  (`sc0rebreaker.github.io/dota-translator/key.html`) from v0.2.7; it
  opened the bundled copy, and a `file:///C:/Users/...` address looked
  like a wrong link to the user.
- **The line goes when the game's line goes** (`fadeWithGame`, default
  true, `above` mode only; the user asked for it). MEASURED with
  half-second screenshots from the rig's Enter: the game's line is fully
  there at 7.0s and gone at 7.5s - a cut, not a fade. Ours is held 7000ms
  from when it was first SHOWN (as said, ~0.2s in), not from when the
  English arrived, then 250ms of fade; a translation that arrives very
  late still gets 2.5s. SEEN: at 7.2s the game's line half faded and ours
  up, at 7.8s both gone. That leaves ~6s of English after a 1.1s model.
- **Hero portraits before the name, as the game has them** (the user
  asked; `showHeroes`, default true). Each line's markup begins with
  `<img class="HeroIcon" src="...npc_dota_hero_furion.png" />`, long before
  the 48 bytes that are passed on, so the panel reader pulls the name out
  (`HeroIn`, line event `h`) - the SCANNER fallback cannot, and leaves the
  space empty so names still line up. The game's own portraits are inside
  its VPK archives, so they come from Valve's public image server,
  `cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/<name>.png`
  (256x144, the same internal name; checked: 200 for furion and centaur).
  It is the app's only network use besides the model, and the README and
  the landing page say so. Sized from the game: 7 units of padding, 43.5
  wide, 16:9, text at 49. `parseEvent` only takes `[a-z_]` for a hero - it
  goes into a URL. SEEN over the live match: same portrait, size and
  place as the game's own line beneath it.
- **AFTER A MATCH, IN THE MAIN MENU (the user, in the installed app): the
  overlay said "Finding the chat in memory..." and then flashed the last
  lines of the finished game.** Three faults, all fixed in v0.2.5, and
  REPRODUCED first: `tools/fakechat.ps1 -EndAfter 7` ends the stand-in's
  match while the process stays open (the HUD panel stops validating, its
  strings stay in memory) and copies the chat, a line at a time, into a
  ChatLinesPanel under `DotaDashboard`. The released helper put five
  "copied" lines out and ran a full sweep; the fixed one, none and none.
  1. **Only a MATCH's panel is read** (`InMatch`: under DotaHud). The
     menu's and the post-game's panels are watched - they are how a new
     match is noticed - and never read. The game copies the match's chat
     into them, and an APPENDED line counts as new whatever it says, which
     is exactly the rule that made repeats work.
  2. **Once the panel reader has worked in a game, the scanner never runs
     again in it** (`$panelEverFound`). With the match over it swept the
     process and dug the finished game's chat up out of freed memory. It
     is for the day the panel cannot be found AT ALL. After the panel goes
     there is one search at once, then only when the game's memory moves.
  3. **The overlay shows errors and nothing else.** How the app is getting
     on is for `npm run watch` and `DT_DEBUG`, not for the player's screen.
  NOT seen on the real game yet: only on the stand-in.
- What it gives up: the English is up to six rows above the line it
  translates when the chat is nearly empty. What it avoids is everything
  that went wrong with cover: the strip, the guess at when the game's
  line fades, the opened chat.
- **The overlay hides when Dota is not the window in front** (helper sends
  `{"t":"focus","on":0|1}` on change; Electron cannot see other apps'
  windows). Built for every display mode. NOT yet seen working.
- `cover` and `box` remain as settings.

**COVER MODE: BUILT, and seen working over the live game (2026-09-20,
19:40). It was the default for half an hour; see ABOVE MODE.** The read-only route was
tried first, as the user chose, and it was enough: the English is laid
over each line of the game's own chat, in that line's exact slot, as
`[Allies] name: english (original)`, portrait left showing. A screenshot
of three lines (team, all, team) shows every strip on its row.

- **Where the chat is comes from the game, not from constants per
  screen** (`tools/panellayout.ps1` found the fields): a UI panel keeps
  its size at +0x50/+0x54 and its position in its parent at
  +0x1b0/+0x1b4, in SCREEN PIXELS, and the UI scale at +0x1e0 (1.33 =
  1440/1080). Up the chat's ancestors only `HudChat` has a position,
  (2026, 827); the rest are 0,0. A line's panel has its height at +0x54
  (34; more when wrapped) and its TEXT width at +0x1a0. **A line's own y
  is not kept anywhere found** (0, with FLT_MAX beside it, even while
  visible): lines are simply stacked, newest lowest, so the overlay
  stacks them itself from the heights.
- **Two calibration constants, from ONE screenshot on ONE screen**
  (`main.js`): the line box starts 31.5 units right of HudChat's x and
  the newest line ends 140 units below HudChat's y, in 1080-high layout
  units, times the scale the game reports. Text starts 49 units into the
  line (7 padding + the portrait). That these are layout constants that
  hold at 16:9 / 16:10 / 4:3 / a flipped HUD is a BET, not a measurement.
  If strips are off on another screen, these three numbers are why.
- The helper sends `{"t":"layout", x, y, s, rows:[{a,h,w}]}` - newest
  first, 10 rows, `a` = address of the row's text (0 for a row that is
  not a chat line: it still takes its place) - when the stack changes and
  for two polls after, because a line's width is not there until the game
  has laid it out. Before the lines of the same poll, not after.
- `memsource` reports EVERY sighting of a line (`onSeen`), repeats too:
  the panel remakes all its children at new addresses when it trims, the
  tracker rightly drops those, and without the sightings the cover would
  lose every strip at the first trim. The overlay keys English by
  channel|name|text and maps address -> key. NOT yet seen across a trim.
- **The game shows a chat line for about 5 seconds** (strip of timed
  screenshots: there at 4s, gone by 7s), and a faded line KEEPS ITS SLOT
  (the next line appears at the bottom with the gap above it). So a strip
  stays put and outlasts the Russian under it, for `holdSeconds`.
- **The dark strip is only there while it has something to hide.** The
  user asked for no box, as Dota's chat has none; but without a write to
  the game the Russian is still drawn under the English, so for the
  game's own ~5s (`GAME_SHOWS_MS` 6000 from first sighting) there is a
  soft strip fading out to the right, and after that bare outlined text.
  SEEN in two screenshots 7s apart: strip then bare; a bot's English line
  between two translated ones left alone in its slot; and the strips moved
  up a row with the game's stack when a new line arrived. A chat with no
  box at all from the first moment needs replace-in-place (below).
- **WATCHING THE USER'S OWN CHAT (19:48-19:55), what was seen:** eleven
  of their pasted Russian lines translated and laid on the right rows,
  rows moving up with the stack. THREE FAULTS, the first fixed:
  (1) the strip went bare at 6s while the game still showed its line -
  English printed over Russian, twice; now 8.5s. (2) NOT FIXED: the
  overlay stays on top when the user alt-tabs - English drawn over their
  browser. Hide the window when Dota is not the foreground window.
  (3) NOT FIXED: with the chat OPENED (Enter) the game shows old lines
  again and a bare strip lands on top of one. Needs a "chat is open"
  signal. NOT in the nine UI panels from ChatLinesPanel up to HudChat:
  every byte of +0x40..+0x300 was the same open and closed. The float at
  +0x58 is not visibility either (static per line; on the wrapper it
  spikes and decays like a scroll). The client-side objects (+0x8 of each)
  were the next place to look; the user stopped that experiment, which
  presses Enter and Escape in their game - ASK before running it again.
  Until then the honest fallback is to never go bare.
- Chinese lines (voice-line pastes) are ignored by design: `scripts` is
  ["cyrillic"]. `"han"` exists; the prompt is written for Russian.
- Pending rows are not drawn in cover mode (the line is already on
  screen, in Russian, where the English will go), nor are lines that
  failed to translate. With no layout - scanner fallback, no match yet -
  cover mode IS the box.
- NOT handled: the chat OPENED (Enter) shows the scrollable history, where
  this stacking is wrong; a wrapped line's strip (`.wrap`) has never been
  seen; the electron window is 1333x453 over the middle of the game and
  click-through, which has not been played with.

## REPLACE IN PLACE: asked for as the DEFAULT, not built, one experiment blocked

**What the user asked for (2026-09-20, during the second bot match):**
rather than a second box positioned for every screen size, put the
English in the game's OWN chat, where the line already is, as
`english (original russian)` - and nothing in brackets when the line was
English already. Two modes the user can choose, **replace the default**,
the extra chat box the other. `display: "box" | "replace"` exists in
config; only `box` is built, and `replace` falls back to it and says so.
The chat box already uses the `english (original)` format, on one line.

**Where it stopped:** the first experiment - overwrite the bytes of one
of our OWN test lines in a bot match and see whether the chat redraws -
was DENIED by Claude Code's permission classifier ("Modify Shared
Resources") before anything was written. Nothing has ever been written
to the game. Do not work around that; the user has to allow it (a Bash
permission rule) or run the probe themselves.

**What is known without writing, for whoever picks this up:**

- The text object (vtable `panorama.dll+0x4674b0`): +0x10 -> the string;
  **+0x38 and +0x40 both held 0x4c1 (1217) for a 327-byte line** - not
  the length, not yet understood (a capacity? a hash?). A write longer
  than the original cannot be done by overwriting alone.
- `english (russian)` is ALWAYS longer than the original, so in-place
  overwriting can never be the whole answer: a new string has to be
  allocated in the game or the pointer at text+0x10 swung to memory we
  own in the game's address space (`VirtualAllocEx`) - a bigger step than
  a byte write, and whatever frees the string later will free OURS.
- The label almost certainly does not re-lay-out because its source
  bytes changed; Panorama lays text out once. But **the panel throws all
  its children away and rebuilds them at 24 lines** - from what source is
  exactly what the experiment would show. If the rebuild reads the
  strings we changed, replace is "write, then wait for / provoke a
  rebuild"; if it re-runs the template from the message data, the place
  to write is the dialog variable, not the markup.
- **A read-only way to get the same look, worth trying FIRST:** cover the
  game's chat instead of changing it. A chat line's UI panel carries its
  own layout: child +0x50 held the floats 1000.0 and 34.0 (0x447a0000,
  0x42080000) - very likely the line's width and height - so the
  position is probably in there too. Read that, and the box can be laid
  exactly over each line on any screen size with no per-resolution
  numbers, which was the user's objection to a second box - and with no
  write to the game at all, so the ban-risk story does not change.
  NOT verified: which floats are x/y, and whether they are screen pixels.

## Open issues, in the order they matter

### 0. What the panel reader has NOT been through

- **Anything but one bot match on one evening.** Not a whole match, not
  a match boundary, not the menu -> loading -> hero pick -> game path,
  which is where `Settled` and the 20s re-find either work or do not.
  Nothing about that path has been SEEN; it is designed from the four
  panels that exist mid-match.
- **How the game feels.** Nobody has played with it. The read is ~3 KB,
  but the FIND is 9-13s of sweeping, and if it lands in a fight it may
  be felt. It should land in the loading screen. Frame time is still the
  measurement that decides, and has still never been taken.
- **WHEN A DOTA PATCH BREAKS IT** (the user asked for this to be in the
  notes; it has NOT happened yet, so everything below is design, not
  experience):
  - **What breaks:** the fast reader depends on seven memory offsets and
    four layout numbers, measured on ONE game build (2026-09-20). They
    belong to Dota's UI ENGINE (Panorama), not to gameplay: a balance patch
    should not touch them, an engine update could. **How often is
    UNKNOWN** - there is one build's worth of data. Do not guess a rate.
  - **What the player sees until it is fixed:** the app does not go dark.
    `find` reports 0 panels, and because the panel reader has then never
    worked in that game, the old SCANNER takes over: it needs no offsets,
    but lines arrive in seconds rather than 0.2s, it costs half a core
    rather than 0.3% of one, and a repeated line is shown once. With no
    layout from the game, the translations move to the dark box in a
    corner (`above` and `cover` both need the same offsets). No hero
    portraits either: the scanner cannot see them.
  - **The fix is ONE COMMIT, not a new version:** re-derive the offsets -
    about an hour with `tools/ptrscan.ps1` (the chain is string -> text
    object -> client panel -> UI panel; `-Parents` prints the tree above
    any panel once +0x10/+0x18/+0x28 are right) and
    `tools/panellayout.ps1` for the layout fields - then change
    `offsets.json` AND the matching constants in `memscan.ps1` (a test
    fails if they differ), bump its `version`, push to master. Every copy
    of the app fetches that file at startup, so players get the fix at
    their next launch with NOTHING to reinstall.
  - **When one commit is not enough:** if a patch changes the SHAPE and
    not just the numbers - the text more hops away, the children no longer
    an array - the reader's code has to change, and that is a new release.
    Installed copies then update themselves (see "Releases, auto-update").
  - **How anyone would know:** nothing reports it. `npm run watch` prints
    `looked for the chat panel: 0 found`, and a player notices the dark
    box and the delay. A way for the app to SAY "the fast reader is not
    working on this Dota build" is not built.
  - Self-calibration (the app re-deriving the offsets by itself) would
    remove the manual hour entirely: noted as LATER, under "Offsets come
    from the repo".
- Identical lines: FIXED for the panel reader (see "It worked at start,
  then stopped"); still shown once under the scanner fallback, which has
  no chat list to ask.
- A line whose text is REWRITTEN in place, same panel and same string
  address, would be missed. Not seen to happen.

### 1. Scanning, which is now the FALLBACK: it finds every line, but cannot be both instant and light

User-reported the first time the overlay was ever left running while
actually playing: *"my game seems laggy"*. Believe it; it is not
imagination. What it was then: **~710 MB read every 2 seconds across
three threads**, roughly 350 MB/s of memory bandwidth, at normal
priority, plus a leftover scanner from testing doing the same beside it.

**The lesson, which is the part worth keeping:** a poll's WALL time is
not its cost to the game. 470ms looked cheap all afternoon, nothing here
had measured a frame time, and the player noticed before any number did.
The measurement that decides anything is frame time in the game, not
milliseconds in the scanner.

**What was built on 2026-09-20 (night), all tested against the stand-in
and NONE of it yet against Dota:**

- **Three kinds of scan** (`mode` in the stat): `full` sweeps the
  process, `wide` reads the hot allocations (the old poll, ~710 MB), and
  `win` reads only `scanWindowMb` (4) either side of every address a line
  has been seen at. Every `scanWideEvery`th (5th) poll is wide, so a line
  written somewhere new is late by at most five polls, not lost. Windows
  follow the chat: every hit, from any scan, adds one; a full sweep
  starts them again. `scanWindowMb: 0` is exactly the old behaviour.
- **Polls run on one thread, sweeps on two, and the whole helper at
  BelowNormal priority**, so it only gets a core nothing else wants.
- **The worst case is known and is tolerable:** if windows turn out
  worthless, this is a 10-second poll at a fifth of the old bandwidth.
  If they work, it is a 2-second poll at a few percent of it.

**THE ONE THING ONLY A LIVE GAME CAN SAY: how far a new line lands from
the nearest old one.** The 4 MB is a guess. The measurement is built in:
with `"learn": true`, every new line writes a `placement` row to
`learn.log` - the scan mode that found it, whether a window covered it,
and its distance in bytes from the nearest hit of any EARLIER scan (not
this scan's: every line is in memory twice, a few hundred bytes apart,
and measuring against its own second copy would make any window look
perfect). Read it like this:

- rows mostly `mode=win` -> windows work; size `scanWindowMb` to cover
  the larger distances and stop.
- rows mostly `mode=wide inWindow=0` -> the distances say how big a
  window would have to be. If that is hundreds of MB, windows are dead
  for Dota: write that down here and go to option 2 below.

**FIRST LIVE RESULT (bot match, 2026-09-20 18:01, 90 seconds, 12 new
lines). Team chat: windows work. All chat: they do not, on two samples.**

| | found by | inside a window | distance from nearest earlier hit |
|---|---|---|---|
| team chat, 10 lines | windowed poll (9), wide (1) | 10 of 10 | 1.5 KB to 2.6 MB, most under 50 KB |
| all chat, 2 lines | wide poll only | 0 of 2 | 98.8 MB and 14.7 MB |

- Team lines came up on the next windowed poll. All-chat lines waited
  for the wide poll, so they are up to `scanWideEvery` polls late.
- The second all-chat line was 14.7 MB from everything, INCLUDING the
  window the first all-chat line had just made. So all chat is not
  simply "a second place" that one hit teaches. Two samples is not
  enough to size anything on; the raw rows are in the notes.
- **Costs in this match were higher than the table below:** 5 hot
  allocations, not 2. Wide poll 1,170-1,350 MB in 1.5-1.7s on one
  thread. Windowed poll 50 MB / 100ms at first, growing to 145 MB /
  200ms as windows pile up until the next full sweep clears them.
  Full sweep 6.6s / 7,533 MB on two threads.
- **The helper died with its parent against the real game**: node was
  force-killed and the scanner was gone within 5 seconds.
- Two translations took 6s and 14s to appear after the line was FOUND.
  That is the model (a timeout and its retry), not the reader.
- How the game felt: see the next paragraph.

**What the user said after that match, and what was changed for it
(2026-09-20 evening):** the game felt *"ok, the same as without
translator"* at a 2s poll with a wide poll every fifth. And: chat must
be *"pretty much instant"* - a delayed message is never seen in a fight
- and **team and all chat matter equally**. So late all chat is a fault
to fix, not a trade to accept. Changed, NOT yet played with:

- `scanIntervalMs` 2000 -> 1000. Wide poll still every fifth, so all
  chat is up to ~6.5s late until it can be windowed too. If the game now
  hitches every six seconds or so, suspect the wide poll first.
- **The model was most of the worst delays.** MEASURED, six single-line
  calls: 0.7-1.0s five times, and once no answer at all. A call is quick
  or lost, so the first try gets 2.5s (was 12s) and the retry 8s. A lost
  call now costs ~3.5s, not ~13s. `thinkingConfig` is REJECTED by
  gemini-3.5-flash-lite ("invalid argument") - do not try it again.
- `batchMs` 400 -> 150.
- Every placement row now carries `addr`, `region`, `regionMb` and
  `alloc`. **The next match's job is all chat:** a dozen all-chat lines,
  then see whether they share an allocation, a region size, or a
  distance from EACH OTHER. If they do, give all chat its own windows.
  If they do not, the windowed route cannot make all chat instant and
  the chat container (below) is the way.

**SECOND LIVE MATCH (18:10-18:12, 1s poll): all chat is fine, and
something worse turned up - LINES ARE SOMETIMES NOT FOUND WHEN SAID.**

- All chat is NOT inherently far: 6 of 6 all-chat lines were inside a
  window and found by windowed polls. Over both matches 17 of 20 new
  lines were in a window; the three that were not were 14.7, 98.8 and
  214 MB away, the last in a different allocation. Do not build
  per-channel windows; that theory is dead.
- **Five lines surfaced in ONE poll at 18:11:59**, two of them typed 20
  to 35 seconds earlier (they come before lines found at 18:11:24 and
  18:11:37 in the list the user typed from). One line, the first, never
  appeared. Six wide polls ran in between and found none of them.
- Those five sat at evenly spaced addresses (~0x2500 apart) in one
  region, and earlier placements there had distance 0 and 4: the SAME
  SLOTS, reused. That looks like a chat panel laying its lines out again
  (opening the chat box to type is the suspect), not a line being said.
  So some of what has been read all along may be a REDRAW, and the copy
  made when the line is said is sometimes somewhere no poll looks: a
  region over the 64 MB poll cap, or an allocation that was not hot at
  the last sweep. The first match shows the same signature (three lines
  displayed together at 18:02:13-14).
- The same region changed size between polls (13.6 MB, then 2.6 MB), so
  the chat heap is being split and merged under us. A region that merges
  past 64 MB drops out of every poll. One placement was in a 54.2 MB
  region. UNPROVEN that this is the cause; it is the first suspect.
- `tools/whereis.mjs` is the experiment for it: nothing but full sweeps,
  back to back, every copy of every Cyrillic line written to
  `whereis.log` with region size, allocation and whether a poll could
  have seen it. Heavy on purpose; bot match only. **Not yet run on Dota.**
- Cost at a 1s poll, 4 hot allocations: windowed 50-170 MB / 75-220ms,
  wide 760-970 MB / 0.9-1.3s, full sweep 4.4s. The model failed both
  tries once (2.5s + 8s) and the line went up untranslated at +10s.
- How the game felt at the 1s poll, from the user: "ok I think".

**THE CAUSE WAS THE 64 MB POLL CAP, and scanning has now shown its
ceiling (2026-09-20, 18:18-18:32, four harness runs on a bot match).**

Lines are typed INTO the game by `tools/saychat.ps1` now (focus, Enter or
Shift+Enter, paste, Enter - input, not memory), so every line has a send
time to the millisecond. `tools/latency.mjs` runs the real reader beside
it and prints say -> found per line plus processor use;
`tools/whereis.mjs` does back-to-back full sweeps and logs every copy.

- **A team line is in memory 4-5 times over (plain and markup); an
  all-chat line only once or twice, markup only.** Of three all-chat
  lines, two had NO copy in any region under 64 MB, ever: they sat in
  regions of 64.8 MB and 160 MB. Team lines always had one small copy.
  That is the whole of "all chat is late", and the old note that "every
  chat line yet measured was in a small region" is dead: the chat heap
  grows through a match and its regions merge past any cap.
- Windowed polls ignore the cap now (they read a few MB of a region
  however big it is). The wide poll's cap is `scanWideCapMb`, default 0.

| 10 lines, 7s apart, 1s poll | found | median | worst | windowed poll | wide poll |
|---|---|---|---|---|---|
| wide cap 64 MB, run 1 | 10/10 | 1.3s | 7.3s | 366 MB / 465ms | 1,064 MB / 1.4s |
| wide cap 64 MB, run 2 | 10/10 | 2.5s | **23.0s** (and 18.7s) | 336 MB / 428ms | 1,035 MB / 1.3s |
| no cap | 10/10 | 2.7s | 7.3s | 487 MB / 597ms | 2,758 MB / 3.3s |

- Team lines: 0.4-2.7s. All chat: 0.7s when in a window, 5-7s when not.
  About 3 lines in 10 are outside every window.
- With no cap nothing is lost, but the 3.3s wide poll BLOCKS the windowed
  polls behind it, which is why the median got worse.
- **Windows are no longer small.** With giant regions included they add
  up to 340-490 MB per poll, every second.
- **Processor** (Ryzen 9 5900X, 12 cores / 24 threads, 32 GB at 3200):
  the reader is 46-63% of ONE core. The game used 307% of a core with
  the reader and 307% with no reader at all (the control run), so the
  reader does not make the GAME work harder. The first two runs seemed
  to show the game doubling; that was Dota waking up after being brought
  to the front, which is why the control exists. Memory bandwidth is not
  in any of these numbers.
- **The user's requirement, stated this evening: it must feel fine on a
  WORSE PC than this one, and chat must be near instant.** Half a core
  and ~0.5-0.8 GB/s of reads is nothing here and is a real share of a
  four-core laptop. Scanning cannot be both instant and light: every gain
  in latency above was bought with more reading.

**So the next piece of work WAS the chat container (option 2), not more
tuning - and it is done; see THE CONTAINER below.** Read the chat log's own structure - a few KB per poll - and
both problems go at once. The tools above make that tractable: type a
line at a known time, find every copy, and look at what POINTS to them.
The plain copies (team) and the markup copies sit in different places;
the container is whatever holds the pointers, and `whereis.log` addresses
are where to start looking for it.

**THE CONTAINER HUNT: tools built and proven on a stand-in, NOT yet run
on Dota (2026-09-20, late).**

- `tools/ptrscan.ps1` finds every chat line, then every pointer into
  one (level 1), then every pointer at what HOLDS those (level 2), and
  so on; rows with the surrounding bytes go to `ptrscan.log`.
  `tools/ptrview.mjs` counts what repeats in it. `-Dump 0xADDR` prints
  annotated qwords; `-Targets` starts from addresses instead of strings.
- `tools/fakechat.ps1` compiles a NATIVE stand-in (fakedota.exe, in the
  temp folder) with a real container: panel -> reallocating array ->
  labels -> text. The node stand-in cannot do this; node does not know
  its own addresses. **Its layout is invented.** Against it the tools
  recovered, blind: label class with text at +0x98, 21 of 24 followed
  pointers; and at level 3 the array start held at panel +0x58.
- Two things the stand-in taught, so they are not relearned on the game:
  **walking back to a null does not find where a string starts** (heap
  headers are not zeros), so level 1 takes any pointer INSIDE a line and
  follows the ones at the commonest beginning; and **a range search
  above level 1 drowns** (840 then 7,370 rows from 12 lines), so higher
  levels look for exact pointers to candidate object starts (every
  module address - a vtable - in the 0x200 before the holder) and to
  array starts. A class is named by MODULE OFFSET, which survives a
  restart where an address does not.
- Cost on the game, MEASURED: see "Cost of the hunt itself" below.
- What to read from the live run: does one class @ offset repeat once
  per line at level 1 (the label)? Is there an array start at level 2-3,
  and what class holds it? Is anything held in module data (a ROOT -
  then no sweep is ever needed to find the panel again)? Run it twice, a
  minute and a few lines apart: what stayed put is the container.
- The reader was deliberately not written until the game had been
  looked at, and that was right: the real chain is three hops, not one,
  and the stand-in's first layout was wrong in every offset.

**THE CONTAINER, MEASURED ON THE LIVE GAME (bot match, 2026-09-20
18:46-18:55; six lines typed by the rig, three team and three all).**

```
ChatLinesPanel (a panorama UI panel)
  +0x00 vtable  panorama.dll+0x45ca68     (every UI panel has this one)
  +0x08 -> its client panel
  +0x10 -> its id, a plain C string: "ChatLinesPanel"
  +0x18 -> its parent UI panel
  +0x28 int   child count        (15)
  +0x30 -> array of child UI panels, IN ORDER SAID
  +0x38 int   capacity           (16)
child UI panel  +0x08 -> client panel    vtable client.dll+0x4fafcf0
client panel    +0x90 -> text object     vtable panorama.dll+0x4674b0
text object     +0x10 -> the line: UTF-8, null-terminated, the markup
```

- **13 live lines, 13 text objects, 14 client panels, 14 UI panels, one
  array.** Team and all chat, the rig's lines and the bots', no
  exceptions: there is no second place for all chat here. 15 children
  against 14 lines: the first child is something else (3 children of
  its own, no chat text); a reader must skip what has no line in it.
- The whole line is `<span class="GameAlliesChat Sent Visitor"><panel
  class="HeroBadge" /><img class="HeroIcon" src=...hero_furion.png" />
  <span class="ChatTarget">[Allies] <span class="ChatPersona">...` - so
  the CHANNEL IS ALSO IN THE FIRST CLASS (`GameAllChat` /
  `GameAlliesChat`), and `Sent` / `Received` says whose line it is.
- Re-read ten minutes of tool-building later: same panel, same array,
  same count. Stable while nothing is said.
- **A poll is 24 bytes of panel + 8 bytes per line**, and ~1 KB per NEW
  line. Against 340-490 MB.
- **How to find it with no vtable offset and no chat yet:** find the
  string `ChatLinesPanel`, find what points at it, take holder - 0x10,
  and validate (its parent at +0x18 and its children all begin with the
  same 8 bytes it does). Offsets +0x08/+0x10/+0x18/+0x28/+0x30, +0x90
  and +0x10 are the patch-fragile part; the scanner stays as the
  fallback for the day they move.
- Also seen, not followed: every text object is pointed at from a table
  around 0x551f212xxxx (entries 0x40 apart, no class nearby) - some
  registry of them. And the markup TEMPLATE (`{s:target_class}
  {s:sender_class}...{g:dota_filtered_string:message}`) is in memory ten
  times: the message is a dialog variable, which is where REPLACE IN
  PLACE will have to look.
- Cost of the hunt itself: strings 7.6s / 6.7 GB (private only), each
  pointer level 2.7-4.8s / 7.8 GB, two threads, BelowNormal.
- **There are FOUR ChatLinesPanels, under three roots** (`ptrscan
  -Parents`): `HudChat` and the hero pick's `PreGame > ... > Chat`, both
  under `DotaHud`; `LoadingScreenChat` under `DotaLoadingScreen`; and
  the menu's under `DotaDashboard`. Every one has the same six wrappers
  above it (ChatLinesWrapper, ChatLinesContainer, ChatChannelArea,
  ChatLinesArea, ChatMainPanel, two unnamed). Mid-match only HudChat had
  children. Each panel has its OWN copy of the id string, so a re-find
  cannot skip the string sweep.
- **So finding A panel is not finding THE panel.** In the menu the
  dashboard's exists and the match's does not yet. The reader is
  `Settled` only when a panel is under `DotaHud` or has children; until
  then it sweeps again every 20s (`-PanelRefindMs`) - in the menu, where
  a sweep costs nobody a frame. While settled it never sweeps.
- **AT 24 CHILDREN THE PANEL TRIMS TO 16 AND MAKES EVERY CHILD AGAIN**
  (seen three times: 23 -> 16 with "15 new"). Same panel, same address;
  new child panels, new strings. That is the "five lines surfaced in ONE
  poll ... the SAME SLOTS, reused" of the second live match, explained:
  it was never a redraw on opening the chat box, it was the trim. A line
  said in the same poll as a trim still came through (60ms).
- The three roots sit together in a 3-entry vector (count 3, capacity 4)
  at a heap address with no class near it, and nothing in any module's
  data points at it; three stale copies of the vector header exist with
  counts 1, 2, 3. A static root was NOT found. Not needed now: the
  re-find rule above covers it. Worth another look only if the 9-13s
  find ever has to go.

**THE PANEL READER (`src/memscan.ps1`, "THE CHAT PANEL"), and what it
did on the live game:**

- Find: sweep private memory for `ChatLinesPanel\0`, sweep again for
  aligned pointers to any hit, holder - 0x10 is a candidate, `Valid`
  decides. Poll: header (0x40), child array, three pointer reads per
  child; a child is re-read only when its string POINTER changes; a
  child with no chat line in it is asked 8 times and then left alone.
- The line it emits is cut exactly as the scanner cuts one (48 bytes
  before `class="ChatPersona"` to the null), so `chatmem.js` and
  everything after it did not change at all.
- A search is a `find` event, NOT a `stat`: the first stat ends priming,
  and a find arriving as one would put the whole backlog on the overlay.
- Settings: `chatPanel` (true), `panelIntervalMs` (250).
  `tools/panelwatch.mjs [process] [seconds] [--no-panel]` is the reader
  with no model, timestamps to the ms; `tools/fakechat.ps1` is the
  stand-in it was proven on first (found in 20ms, lines out in ~160ms).
- Live, run 1 (8 lines, 4s apart): 181, 164, 277, 290, 116, 117, 226,
  231ms. Run 2 (4 lines): 103, 275, 60, 254ms. Send time is the rig's
  Enter; found time is node receiving the line. Idle poll 0.7-1 KB, a
  new line ~3 KB, a trim ~31 KB, every one "0ms".
- No strays after any run (checked, excluding the query's own pid).

**Then measure frame time in the game**, windows on against
`scanWindowMb: 0`, before believing any of it.

What the stand-in's frame proxy said (`tools/fakedota.js`, a timed 32 MB
copy per "frame"; a PROXY, and a weak one - Dota is not a memcpy loop):

| reader | frame p50 | frame p99 |
|---|---|---|
| none | 2.1-2.3ms | 3.5-4.4ms |
| 1.27 GB swept back to back, 3 threads, normal priority | 2.4-2.8ms | 4.6-6.1ms, rising |
| same, 1 thread, BelowNormal (half the read rate) | 2.6ms | 4.4ms, steady |
| new defaults (windowed, 45 MB polls) | 2.4ms | 3.7-4.9ms |

It agrees in direction and proves nothing about Dota. At ~250 MB/s the
proxy could not tell any configuration from the baseline at all, which is
itself worth knowing: it does not reproduce whatever the player felt.

Still open if windows fail: **find the chat log container and read it
directly** - a few KB per poll, nearly free, the most fragile across
patches.

### 2. Never run against the live game without asking

The game belongs to the person playing it. Do not start a scanner, the
watcher or the overlay against a running Dota without the user's say-so,
and stop everything when the measurement is done.

Check for strays before and after: list `powershell.exe` processes whose
command line contains `-File` and `memscan`, with their
`ParentProcessId`, **and exclude the query's own pid** - a query whose
command line contains those words matches its own filter, and that has
now cost a round of confusion twice.

**The helper dies with its parent now.** It is passed `-ParentPid`, holds
that process as an object (a pid is reused; a handle is not) and exits at
the top of the next loop once it has gone. MEASURED, writing to a file so
no broken pipe could help: watching a 4-second process, the scanner was
gone by 10s; the control given no pid was still running. NOT reproduced:
the original stray itself. Force-killing a node parent in this harness
ended the scanner even with no pid passed, game or no game, so whatever
kept the first stray alive (Electron as the parent is the obvious
suspect) has not been seen again. The check costs nothing either way.

### 3. Not yet seen

- **A whole match**, and two matches in one process launch: whether the
  hot allocations stay the right ones, and what happens at a match
  boundary when the process does not restart.
- **Spectator and coach channel tags are guesses.** An unknown tag is
  reported and written to `learn.log` rather than failing silently - set
  `"learn": true` and that file is the answer to what changed.
- **Replace-in-place** - decided, wanted, not started. See the decisions
  below before designing it.

---

## Offsets come from the repo, not from the build (2026-09-20, late)

The user asked whether a Dota patch needs a manual update. It did: seven
memory offsets and four layout numbers were constants, and there is no
installer or updater, so a fix meant everybody pulling a new version.

- **`offsets.json`** (repo root) holds them all. **`src/offsets.js`**
  fetches it from `raw.githubusercontent.com/.../master/offsets.json` at
  startup (3s at most, never fatal), and believes, in order: what it just
  fetched; the last good fetch (`offsets.cache.json`, gitignored - so a
  fix survives being offline); the copy that shipped. The higher
  `version` of fetched and shipped wins, so a stale CDN cannot roll a
  newer build back. `offsetsUrl: ""` never fetches.
- **All or nothing.** `parseOffsets` rejects the whole file if any offset
  is missing, not a number, not aligned (8 for pointers, 4 for the rest),
  over 0x2000, or a layout number is out of range. They only ever say
  where to READ; nothing in the app writes to the game.
- The helper takes them as `-Offsets "uiClient=8;uiId=16;..."` and sets
  the C# statics by reflection; names it does not know and values that
  are not plain digits are skipped. `scannerArgs` refuses anything that
  is not names and digits - it is a command line. The panel header read
  grows to fit whatever the offsets ask for.
- `npm test` fails if `offsets.json` and the constants compiled into
  `memscan.ps1` ever differ: two copies of one measurement must not drift.
- PROVEN on the stand-in (`panelwatch.mjs fakedota --offsets ...`): the
  shipped offsets read 4 lines in 7s; the same with `clientText` moved by
  8 read none. A real fetch answered 404 in 0.3s and fell back to the
  bundled copy, as it should - because:
- The repo was private when this was built and went public later the same
  evening. The fetch still answers 404 until `offsets.json` is PUSHED:
  master was 20-odd commits ahead of origin, and pushing is the user's.
- **AFTER A PATCH:** re-derive with `tools/ptrscan.ps1` /
  `tools/panellayout.ps1` (see THE CONTAINER), change `offsets.json` AND
  the constants in `memscan.ps1`, bump `version` and `updated`, commit,
  push. Nothing else.

**LATER, NOT NOW (the user's words: "mark this to the notes to do later
maybe"): self-calibration.** The app re-derives the offsets itself by
automating the pointer chase done by hand on 2026-09-20 - find a chat
line's string, find what points at it, climb to the panel whose id is
`ChatLinesPanel`, read the offsets off the distances - and caches the
result per game build. No manual update at all, ever. It is a real piece
of work (the chase needed a human to tell signal from noise at each
level), and it must be proven against `tools/fakechat.ps1` with a
DIFFERENT layout than the one it expects before it is trusted on the game.

(The app updating itself was "later, not now" on 2026-09-20 and was built
the same evening, with the installer: see "Releases, auto-update and the
icon".)

## Releases, auto-update and the icon (2026-09-20, v0.2.0)

- **A release is a TAG.** `.github/workflows/release.yml` runs on any
  `v*` tag: windows-latest, `npm ci`, `npm test`, checks the tag equals
  `package.json`'s version, then `npm run release` (electron-builder
  `--publish always`), which uploads the installer, its blockmap and
  **`latest.yml`** to a GitHub release. The only credential is the
  workflow's own `GITHUB_TOKEN` - chosen over driving the API with the
  user's stored git credential, which would have meant handling their
  token. To cut one: `npm version patch` then
  `git push origin master --follow-tags`.
  `package-lock.json` is COMMITTED now (it was gitignored; `npm ci` needs it).
- **v0.2.0 WAS BROKEN, and why the workflow does not let electron-builder
  publish:** its uploader raced itself and made TWO releases for the one
  tag, the installer in one and the blockmap in the other, so the download
  link was a 404 while the API said all was well. The workflow now builds
  with `--publish never` and makes ONE release with `gh release create`
  (deleting any earlier attempt under the same tag first). v0.2.1 was made
  that way and CHECKED: one release, three files, the 80 MB installer
  downloads, `latest.yml` names it. Check the DOWNLOAD, not the API.
- The installer has a version-less name from v0.2.2
  (`Dota-Translator-Setup.exe`), so the site links straight to
  `releases/latest/download/Dota-Translator-Setup.exe`.
- **The installed app updates itself, USUALLY - and here is when it does
  not.** The rule: it looks for a newer release at startup and every four
  hours, downloads it quietly, and installs it when the app is next
  CLOSED (and says so in the tray tooltip). The edge cases:
  - **A copy that is never restarted never updated** - FOUND on the user's
    own install, 2026-09-20: v0.2.2, started 21:56, still v0.2.2 with
    nothing downloaded while v0.2.3, .4 and .5 came out, because it looked
    ONCE, at startup. Fixed in v0.2.6 (the four-hourly look) - but a copy
    OLDER than v0.2.6 still only looks at startup, so it needs one restart
    to get there. After that it keeps itself current.
  - **It installs on a CLEAN quit only** (tray > Quit, Alt+Shift+D). Killed
    from Task Manager, or Windows shut down under it, the downloaded update
    waits for the next clean quit.
  - **A copy installed from the very first local build, v0.1.0, has no
    updater at all.** Reinstall from the website.
  - The installer is unsigned; updates still work (no publisherName is
    set to verify), but SmartScreen warned on the first install.
  - `autoUpdate: false`, and any run from source, never looks.
  To check a machine: the exe's version is in
  `%LOCALAPPDATA%\Programs\dota-translator\Dota Translator.exe`, a
  downloaded update waits in `%LOCALAPPDATA%\dota-translator-updater\pending`,
  and the tray menu shows the running version.
- How it is built: `electron-updater`, GitHub provider, `checkForUpdates`
  in `main.js`; downloads in the background - never a
  dialog over a match. `autoUpdate: false` never checks; run from source
  it never checks. The tray tooltip says when a version is waiting, and
  the tray menu shows the running version. SEEN in the packaged build:
  it reached GitHub and answered "No published versions", which was true.
  **NOT seen: an actual update** - that needs two releases. Unsigned
  builds update fine on Windows (no publisherName is set to verify).
- **The icon is ours**: two chat bubbles, a grey "Я" behind an amber "A"
  (`build/icon-source.html` is the drawing; `build/icon.ico` 16-256,
  `src/tray.png`, `docs/logo-{64,192,512}.webp`, `docs/logo.svg`,
  `docs/favicon.ico`). The user asked for "something with dota logo (if
  they allow it)": they do not - it is Valve's trademark - so nothing of
  Valve's is in it. On the site's nav, as favicon and og:image, in the
  setup window, the tray, the exe and the installer. The WebP files were
  encoded by a headless browser's canvas (`toDataURL('image/webp')` read
  back with `--dump-dom`): there is no image tool on this machine.

## The installer (2026-09-20)

The user: "too complicated for non techie users ... pretty much plug and
play, except for adding the api key ... download -> installs the app".

- **`npm run dist`** (electron-builder, NSIS, x64) builds
  `dist/Dota-Translator-Setup-<version>.exe`, ~80 MB: one click, installs
  for the current user only (no administrator), Desktop and Start menu
  shortcuts, starts the app when it finishes. `dist/` is gitignored.
- **What had to change for an installed app**, all in `src/config.js`:
  the app then lives in `resources/app.asar`, which cannot be written to
  and which nothing OUTSIDE the app can read. So `DATA_DIR` - settings,
  `offsets.cache.json`, `learn.log` - is `%APPDATA%/Dota Translator` when
  packaged (beside the source otherwise), and the two files the outside
  world opens are unpacked by the installer (`asarUnpack`): `src/*.ps1`
  for PowerShell and `docs/key.html` for the browser; `onDisk()` and
  `memsource.SCRIPT` point at `app.asar.unpacked`.
- PROVEN on the packaged build (`dist/win-unpacked`, run against the live
  match with `DT_CONFIG` pointing at the real settings so no setup window
  opened): offsets fetched, the reader ran from
  `...app.asar.unpacked\src\memscan.ps1`, the chat layout was found, and
  the helper exited within ~9s of the app being force-killed.
- **NOT done / NOT seen:** running the INSTALLER itself (it installs and
  launches, and a first launch with no key opens the setup window over
  whatever is in front - the user said they would run it themselves); the
  uninstaller; a machine without Node. **It is NOT code-signed**, so
  SmartScreen warns ("More info" -> "Run anyway"); the page and README say
  so. It uses Electron's default icon - there is no app icon yet.
- **No release exists yet.** The landing page's buttons and the README
  point at `releases/latest`, which is EMPTY until the user uploads the
  exe to a GitHub release (`gh` is not installed here, and publishing a
  binary under their name is theirs to do). Until then those buttons lead
  to an empty page.
- Auto-update and releases: see "Releases, auto-update and the icon".

## A player who cannot find the app (v0.2.8, 2026-09-20)

The user: with a key saved the app starts straight into the tray, "a non
tech user may not find it", and the SmartScreen warning "might be scary".

- **One copy only** (`requestSingleInstanceLock`). There was NO lock
  before: starting it twice meant two readers and two consumers of one
  key. Starting it again now opens the settings window of the copy that
  is running - which is what somebody who cannot find the icon does.
- **A tray balloon at startup when there is a key** says where it went
  ("by the clock, behind the ^ arrow"); clicking it opens settings. The
  setup window's "It works" message says the same. NOT seen: the balloon
  itself, nor the second-launch path - neither was run here (the user's
  installed copy was running, and a dev copy beside it is two consumers).
- **`docs/install.html`**: the blue warning DRAWN twice (before and after
  More info, the button ringed), why it appears (unsigned = no paid
  certificate, not a finding; built on GitHub from public source), and a
  drawing of the tray with the ^ flyout. Linked from the landing page's
  steps. SEEN at phone width in the browser pane only.

## The website counts visits (2026-09-20)

The user wanted to see "if anyone even went there". `docs/analytics.js`
(GA4, `G-RX1LXWKFZD`, the user's property) is loaded by every page in
`docs/`, does nothing on localhost or from a file, and sends events a page
view cannot: `download_click`, `aistudio_click`, `github_click`,
`guide_click`, `slider_used`. The landing page's footer says so. `npm
test` fails if a page in `docs/` lacks it or if anything like it turns up
in `src/` - the APP has no analytics and must not get any. NOT done: a
cookie consent banner, which GA strictly wants for EU visitors; the user
was told, and chose GA.

## The setup window: the key goes in through the app (2026-09-20)

The user: "simpler for non techie user to just enter api key in the ui ...
some window with similar ui as dota translator page". Editing
`config.json` in Notepad was the step most likely to lose somebody, and a
missing quote there failed silently.

- **`src/setup.html` + `setup.js` + `setup-preload.cjs`**, opened by
  `main.js`: by itself when no key can be found, and from a **tray icon**
  ("Settings and key...", hide/show, Quit) after that. The tray icon is
  drawn in code (16x16 BGRA, amber with a dark T) - there is no image
  file in the app.
- **The key is TRIED before it is saved** (`src/keycheck.js`): one real
  translation of "гг вп". Saved means works. When it does not, the reason
  is turned into something to DO - the 402 (billing project) and 403 (new
  project refused) traps this project lost an hour each to, a mistyped
  key, quota, no internet. Pasted keys are tidied first (quotes, a
  trailing comma, a line break: people copy them out of config files).
- **Stored encrypted**, `geminiApiKeyEnc` in config.json, by Electron
  `safeStorage` (DPAPI: this Windows user only); plain `geminiApiKey` is
  blanked when that works and used only if encryption is unavailable.
  `GEMINI_API_KEY` and a plain `geminiApiKey` still work and still win.
  **`npm run watch` CANNOT read the encrypted key** (no Electron) and says
  so. `saveConfig` changes only what it is given and keeps the rest of the
  player's file, their own extra keys included.
- The page has a CSP of `default-src 'none'`, no web fonts and no URLs at
  all (`npm test` checks), cannot navigate or open windows, and is never
  handed the saved key back - only whether one exists.
- It also picks the look (`above` or `box`); changing it re-places the
  overlay window and reloads its page, which is why the overlay now sends
  its config on every `did-finish-load` rather than once.
- `DT_CONFIG=<file>` points the app at another config: how the first-run
  window was looked at without touching the real settings or key.
- SEEN: the window opening by itself against an empty config, on screen,
  looking as designed. **NOT exercised by me: pasting a real key and
  saving it** - typing credentials into a field is not something I do;
  the check-and-save path is covered by tests with a stand-in translator,
  and the user's own paste is the first real run of it. Also not seen:
  the tray icon itself.
- **The window sizes itself to its page** (the user: "currently the window
  is scrollable - just have it fit the content"): 680 wide, and `fitSetup`
  sets the height to the BODY's measured height (561 with no message),
  again whenever a result appears, capped to the screen. Measure the body,
  not `documentElement.scrollHeight`: a page never reports itself shorter
  than its window, so that can grow a window but never shrink one.
  `DT_SHOT=<file>` makes the window photograph itself - the way to look at
  it while a game covers the screen (a screen capture showed Dota, and a
  search by window title found the USER'S installed copy, not the dev one).
- **"More settings", a fold in the same window, shut by default** (the
  user asked whether the other settings belonged in the UI; the answer
  was FIVE of the twenty-five): which languages, the original in brackets,
  hero portraits, update automatically, text size for the box. The rest
  is engine tuning and stays in config.json - the fold says so and has an
  "Open its folder" button (the file is made first if it does not exist).
  `src/settings.js` decides what the window is SHOWN (never the key) and
  makes safe what it sends back: unknown languages dropped, NO language
  ticked is not saved (an app that translates nothing and does not say
  why), sizes clamped 11-28, anything of the wrong type or not one of the
  five ignored. Saving applies at once: the overlay page reloads, and the
  reader restarts only if the languages changed. With a key already
  saved the button reads "Save" and does not call Google. SEEN by the
  window's own snapshot, fold open (`DT_SHOT_MORE=1`). NOT exercised:
  pressing Save with changed settings against a running match.
- It STOLE FOCUS from the user's game when the test copy opened it. In
  real use it only opens unasked when there is no key, i.e. before the
  first match ever - but do not open it from code while a match is on.

**Chinese is on by default beside Russian** (`scripts: ["cyrillic",
"han"]`; the user: "a lot of chat wheels are chinese ... but main selling
point is russian"). The prompt says most chat is Russian and some Chinese,
and that a pasted Chinese voice line is translated briefly, not explained.
REAL OUTPUT: 夸张哦~ -> "Exaggerated~", 漂亮! -> "Nice!", 打得不错 -> "Well
played". The user's own config.json listed only cyrillic and was given
`han` too. The landing page still leads with Russian; its FAQ says
Chinese works out of the box.

## The key guide (`docs/key.html`, 2026-09-20)

The user asked for "a guide how to get api key with pictures". Linked from
the landing page's first step and from the README's setup.

- **The pictures are DRAWINGS, made in HTML on the page, and say so.** A
  real screenshot of Google AI Studio needs somebody's signed-in account
  and shows a live key. Three browser-window drawings (the API keys page,
  the create dialog with a no-billing project ringed, the copy button)
  and one of `config.json` with the part to change highlighted.
  `npm test` fails if anything shaped like a real Google key is on it.
- The steps follow Google's own page, read 2026-09-20
  (ai.google.dev/gemini-api/docs/api-key): a NEW user gets a default
  project AND a key made for them on accepting the terms; everybody else
  uses Create API key on Dashboard > API keys and picks a project.
- **From that same page, and not yet dealt with:** since 2026-05-28 new
  AI Studio keys are "authorization keys", and Google says the Gemini API
  will REJECT the older "standard" keys "on September 2026". The user's
  key was still working on 2026-09-20. If translation suddenly fails with
  an auth error, a new key from AI Studio is the first thing to try. NOT
  verified: that an authorization key works with the `x-goog-api-key`
  header this app sends (it is still an API key, so it should).
- Troubleshooting on the page is the two key traps this project hit (402
  prepayment depleted, 403 denied on a brand-new project) plus quota and
  a mistyped key.
- **Borderless Window** (the user asked whether it is a hard requirement):
  for the overlay, yes as far as is known - it is a separate window and
  an exclusive-fullscreen game lets nothing on top of it; drawing inside
  the game would mean injecting into its renderer, which this does not do.
  Plain Windowed works too, and the memory reader does not care. ONLY
  borderless has ever been tested. How Dota's "Exclusive Fullscreen"
  behaves under Windows' fullscreen optimisations is NOT known, so the
  page says "use Borderless" and does not claim the other is impossible.

## The landing page (`docs/index.html`, 2026-09-20)

The user asked for a page "to make it sell (even though it's free)",
like Paperbook's (`Desktop/paperbook/web/src/WelcomeV3.jsx`) but shorter,
with a slider. What was built, and the rules it follows:

- **LIVE at https://sc0rebreaker.github.io/dota-translator/** (since
  2026-09-20; the user asked for Pages to be turned on). It is served from
  the `gh-pages` BRANCH, which is nothing but `docs/` of master:
  pushing a branch of that name switched Pages on by itself, with no
  repository setting changed and no credential handled (`git subtree
  split --prefix docs -b gh-pages`, force-pushed; `has_pages` went true
  and the site answered 200 within three minutes).
  `.github/workflows/pages.yml` rebuilds that branch whenever `docs/`
  changes on master - do not edit gh-pages by hand. CHECKED live: /,
  /key.html, the WebP logos and the favicon all 200. Look at it locally with `node tools/serve-docs.mjs` (http://localhost:4173; also the
  `landing` entry in `.claude/launch.json`).
- Same bones as Paperbook's: serif headline with an italic accent, a demo
  in the hero, the numbers in a window card, what it does, three steps,
  **"The catch, up front"**, questions, a closing call. Its own colours
  (amber on near-black) so the two do not look like one product.
- **The slider is the hero**: one chat, drawn twice, the top layer clipped
  at a handle - without / with. Every row has a hero PORTRAIT before the
  name, on both sides (the user asked: "random hero images in front of
  players too, not color, also for the translated side") - four heroes
  drawn at random from sixteen on each visit, the same one for a player
  on both sides of the handle, with the old coloured block behind as the
  fallback. They are LINKED from Valve's image server, as the app's own
  are; all sixteen URLs checked 200. It is a real `<input type="range">` laid
  over the scene, so drag, tap and keyboard all work with no code, and it
  sways once on load to show that it moves. **The scene is drawn in CSS: no screenshot of
  the game and no Valve font, and the portraits are hot-linked, so
  nothing of Valve's is IN THE REPO.** Keep it that way.
- **Every number is a measurement from this file and every translation
  shown is what the model actually answered** (run through
  `translateBatch` before being written down - the first draft had
  invented ones, "go rosh" for what is really "let's rosh"). 45 lines =
  the three `e2e.mjs` runs, 9 + 15 + 21. Two claims were softened because
  they were designed, not seen: that the ten-second search lands in the
  loading screen, and the fallback after a patch.
- `npm test` holds the page to the project's decisions: "at your own
  risk" in so many words, never "safe"/"undetectable", no other product named,
  source-available not open source, and no dead in-page links.
- SEEN: desktop (1280, headless Edge screenshots of every section) and a
  298px-wide phone view in the browser pane. Headless Edge will not go
  narrower than ~500px, so a "phone" screenshot from it is cropped, not
  overflowing - that cost a few minutes. NOT seen: a real phone, Safari,
  or the fonts failing to load (it falls back to Georgia / system UI).
- The call to action is now a DOWNLOAD (`releases/latest`); see "The
  installer" - and note that no release has been uploaded yet.

## Read these first

- `NOTES-2026-09-20-memory.md` - the memory-reading route, the decisions
  already made, and everything measured. **It supersedes NOTES.md's
  conclusion.**
- `NOTES.md` - the original handoff. Every measurement in it still
  stands; sections 2 and 4 ("the only route left is OCR") do not.

Both are committed, and they hold the reasoning behind almost everything
below. Do not re-run an experiment they record.

## Running and testing

```bash
npm start        # the overlay (Electron)
npm run watch    # the same chain in a terminal - use this first
npm run demo     # drives the chain from a fake source, no Dota needed
npm run doctor   # no-key diagnostic
npm test         # 100 tests, plain node assert, no runner
```

Keep `npm test` green. It needs no game running and no API key.

- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Working branch is `master`, pushed to `sc0rebreaker/dota-translator`.
  **The GitHub username changed on 2026-09-20 from `KristjanRanna` to
  `sc0rebreaker`, and the repo went PUBLIC the same evening.** GitHub
  redirects the old repo URLs (web, git, and raw answered 200 under the old
  name that night) but NOT Pages sites or the profile, and a redirect dies
  if anybody takes the old name - so every URL in the app, the page and
  the licence uses the new one. Pages, when it is switched on, will be
  `sc0rebreaker.github.io/dota-translator`. Before it went public the
  whole history was searched for a Google API key (`AIza...`) and for
  `config.json` ever being tracked: neither, on any branch.
- `tools/` holds the test rig: `fakedota.js` (stand-in game),
  `saychat.ps1` (types lines into the real game), `latency.mjs` (say ->
  found, and processor use), `whereis.mjs` (where every copy of a line
  is), `fakechat.ps1` (native stand-in with a real chat container),
  `ptrscan.ps1` + `ptrview.mjs` (what points at a chat line; `-Dump`,
  `-Parents`), `panelwatch.mjs` (the reader with no model, to the ms), `e2e.mjs` (the
  whole chain with the real model: said -> shown -> English),
  `serve-docs.mjs` (the landing page on localhost:4173), `panellayout.ps1`
  (where a UI panel keeps its size and position).
  saychat, latency, whereis, ptrscan, panelwatch and e2e touch the live game: bot matches, with
  say-so.
- **PowerShell variables ignore case**: `$targets` IS the `[string]$Targets`
  parameter, and assigning an array to it joins it into one string. Cost
  a run in ptrscan.
- Source files are LF. There is no build step and nothing compiled.
- The Gemini key is pasted into the app's setup window (saved encrypted
  in `config.json`, which is gitignored), or lives there in plain as
  `geminiApiKey`, or in `GEMINI_API_KEY`.

### Testing the reader with no Dota running

Copy `node.exe` to `fakedota.exe` (anywhere outside the repo), run
`fakedota.exe tools/fakedota.js`, and start the source with
`processName: 'fakedota'`. The stand-in holds the chat strings verbatim
in both forms, says a new one every three seconds - alternately NEAR the
last and FAR from all of them, so windowed and wide polls each have
something only they can find - and times a memory-heavy "frame" as a
proxy for what the reader costs. It has found real faults every time it
has been used. **Do this before touching the live game.**

Two things the stand-in itself got wrong, so they are not rediscovered:
going through `Buffer.from()` or printing a line leaves a second UTF-8
copy of it in node's own buffers, right beside the last one, which made
every "far" line look near; and ballast nothing reads is given back by
V8 - a "1 GB" stand-in swept as 246 MB.

`npm test` also parses every `.ps1` through PowerShell's own parser, with
a deliberately broken script as a control first. The scanner is one file
that nothing else would notice being broken: a syntax error there is not
an error anybody sees, it is a tool that silently never reads a line.

### Testing it by hand, in a game

The first sweep only **primes** - it remembers what has already been said
without showing it - so a line typed *before* the app starts will never
appear. Type something new, and only Cyrillic counts: the Cyrillic gate
deliberately ignores English, so Dota's own localised chat wheel never
costs a model call. Allow a few seconds end to end (up to
`scanIntervalMs` to see it, `batchMs` to gather, about a second for the
model).

## How it works

`src/memscan.ps1` reads the running game's memory - the chat panel when
it can find it, a search of the process when it cannot - and prints one
JSON object per line it finds; `src/memsource.js` keeps that helper alive and
turns its findings into `{name, text, channel}`; `src/chatmem.js` decides
what is a real line; `src/pipeline.js` batches; `src/translate.js` makes
one Gemini call; `src/main.js` + `overlay.*` draw it.

**Nothing downstream of the source cares where a line came from.**
`src/watcher.js` (the old `console.log` reader) is kept for that reason,
though it cannot see chat.

### Facts that cost real time to establish

- **Dota keeps each chat line complete and pre-formatted** as one
  null-terminated UTF-8 string, and a second time as Panorama markup
  carrying the player's colour slot. Nothing has to reassemble fields.
- **All-chat has NO channel tag.** Team chat is `[Allies] name: text`;
  all-chat is just `name: text`, far too common a shape to scan 4 GB for.
  So the anchor is `class="ChatPersona"` (the markup form, which every
  channel has) and the channel is read from what precedes it. Anchoring
  on the tag read team chat perfectly and missed every word of all-chat,
  silently. The real markup also carries the hero portrait before the
  tag - `hero_juggernaut.png" /><span class="ChatTarget">[Allies] <span
  class="ChatPersona">` - and the 48-byte look-back still reaches it.
- **The hot set is ALLOCATIONS, not regions, and that is the whole
  trick.** A new chat line does NOT land in the region the last sweep
  found one in: measured over 95 polls of hot regions, not one new line
  ever appeared in them, and both times chat turned up it was a full
  sweep that found it. It does land in the same heap RESERVATION.
- **Only PRIVATE memory becomes hot.** A line is written; an image is
  static. The one thing the anchor matches in image memory is Panorama's
  own template, `<span class="ChatPersona">%s</span>`, whose 29 MB
  resource region would otherwise have every poll read a quarter of a
  gigabyte of module for nothing.
- **Some hits are freed or half-overwritten memory.** A hit is validated,
  never trusted. `chatmem.js` takes only what parses, is printable, is
  inside the length caps and carries a channel tag it knows.
- **Regions bigger than the buffer used to be skipped whole**: 20 of
  them, 2,972 MB, two fifths of the process, silently. They are read in
  overlapping chunks now, and a string running to a seam is left to the
  next chunk rather than emitted truncated - a truncated line can still
  PARSE, which would put half a sentence on the overlay.
- **A buffer that does not begin where a region begins skips its first
  48 bytes.** The channel tag lives in the look-back before the anchor,
  and a hit that has lost its look-back parses perfectly well as ALL
  chat. A later chunk's first bytes are overlap the chunk before saw
  whole; a window's are a radius away from whatever made it a window.
  Likewise a string running to the end of a WINDOW is not whole, only
  one running to the end of a region is.
- The scan is **one pass** over the buffer, gated on a `bool[256]` of
  bytes that can start an anchor. It used to be one pass per anchor -
  seven passes over everything, six times slower.
- **Reading is memory bandwidth as much as processor.** The region walk
  is sequential (each `VirtualQueryEx` asks about the address after the
  last region); the reading runs on up to three threads.
- While there is nothing to find at all, fruitless sweeps **back off 1s
  to 10s** rather than running back to back.
- **A call to the model that never arrived is made once more.** One of
  the two lines in the first live game timed out at 12s. A refusal, a bad
  key or a quota answer is the model's word and is not asked twice.

### The numbers, measured on the live game

| | cost |
|---|---|
| full sweep | **3.8s**, 7,463 MB, 7,213 regions, three threads |
| full sweep, one thread | 12.6s |
| poll of the hot allocations | **410-780ms**, ~710 MB, ~255 regions |
| poll before the 64 MB region cap | 4.1s |
| windowed poll | NOT measured on the game; 45 MB / ~80ms on the stand-in |
| a sweep, single pass vs one per anchor | 1.5s vs 8.5s per gigabyte |

Defaults are a 2s poll and a 2-minute sweep. **With every poll wide and
three threads, those defaults are what the user called laggy.** Polls are
windowed and single-threaded now (open issue 1); whether that is enough
is not known.

### Routes that are dead, with the measurement

Do not revisit these without reading the notes; a web search will tell
you the first two are open questions, and they are not.

- **`console.log` carries no chat.** The log is written live (the
  widely-cited issue saying otherwise is wrong), but chat is drawn by
  Panorama and never reaches the engine console.
- **`DOTA_CHAT` verbosity is LOCKED.** `log_level DOTA_CHAT default`
  answers "Log verbosity levels are locked", in a match and in the menu.
- **GSI carries no chat.** Map, hero, items, abilities, draft. No
  messages of any kind.
- **Vision works and costs too much** - exact Cyrillic transcription,
  ~1,200 calls a game, which exhausts the free tier in one match. Local
  change-detection does not rescue it: the terrain animates under the
  text, so the region changes every frame anyway.

## Decisions already made - do not re-litigate

- **Ban risk is accepted by the user, explicitly.** Ship at their own
  risk with a clear notice. Word it as *undocumented*, never *safe*.
  Describe it as an *unsanctioned third-party tool*, and NOT as one of the
  overlays Valve permits, which do not read memory. **NAME NO OTHER
  PRODUCT, anywhere public - the page, the README, the notes, this file**
  (the user, 2026-09-20: "I dont want to promote it"). Two were named
  everywhere until then, as the fair comparison and the unfair one;
  `npm test` now fails if either name comes back.
- **Licence is PolyForm Noncommercial 1.0.0** - free for players, a paid
  product may not bundle it. That makes this **source-available, not open
  source**; do not call it open source.
- **Replacing the chat text in place is WANTED, as an option**, after the
  overlay. Argued against once on risk; the user's answer stands. It is
  also genuinely harder: the translation will not fit the original
  allocation, and the text exists in two representations, so which buffer
  the renderer actually reads decides whether a write shows at all.
- Free, own key, donations. No subscription and **no hosted shared API
  key** - with public source that would be strangers' bills.

## Traps that have each cost an hour

- **Never put a backslash escape through a bash heredoc into a patch.**
  It has silently mangled a string literal three times in this project
  and in the user's other one, twice inside the very test written to
  catch the first instance. Twice more on 2026-09-20, both through a
  QUOTED heredoc feeding a node patch script: a newline escape inside a
  template literal arrived as a real newline, and a null escape in a
  match string stopped it matching. Use the Edit tool for any line with
  a backslash in it. **And a sixth time on 2026-09-20 (late), through
  `node -e "..."`, which is the same trap without the heredoc:** a `\0`
  in a C# string arrived in `memscan.ps1` as a real NUL byte. It PARSED.
  `grep` calling the file "binary" was the only sign. `npm test` now
  fails on a NUL or a non-ASCII byte in the code of any `.ps1`.
- **An escape typed into a tool call is a letter by the time it is
  saved.** `И` written into `fakechat.ps1` landed as the Cyrillic
  letter, PowerShell read the BOM-less file as ANSI, and the stand-in
  spoke double-encoded Russian - which the reader, correctly, did not
  take for Russian. An hour of "why does the reader drop every line".
  Cyrillic in a `.ps1` is hex code points (`U("0418 ...")`), nothing else.
- **Never read a test result through a pipe.** `npm test | tail` exits
  with tail's status, so `&& git commit` after it commits a red suite.
  It did, once (af2a78f, fixed in the next commit). Send the output to a
  file and check the exit code.
- **Never have two modules whose names differ only by case**
  (`lateResult.js` beside `LateResult.jsx`). Windows ignores case, the
  import resolves to the wrong file, and the failure looks like anything
  but a filename.
