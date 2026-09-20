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

## Open issues, in the order they matter

### 1. THE READER: cheap enough now by feel, but it MISSES LINES when they are said (see "SECOND LIVE MATCH")

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
- How the game felt at the 1s poll: NOT yet reported.

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
npm test         # 72 tests, plain node assert, no runner
```

Keep `npm test` green. It needs no game running and no API key.

- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Working branch is `master`, pushed to `KristjanRanna/dota-translator`.
- Source files are LF. There is no build step and nothing compiled.
- The Gemini key lives in `config.json` (gitignored) or `GEMINI_API_KEY`.

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

`src/memscan.ps1` reads the running game's memory and prints one JSON
object per line it finds; `src/memsource.js` keeps that helper alive and
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
  Compare to **Overplus**; never to Overwolf, which Valve permits and
  which does not read memory.
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
  a backslash in it.
- **Never read a test result through a pipe.** `npm test | tail` exits
  with tail's status, so `&& git commit` after it commits a red suite.
  It did, once (af2a78f, fixed in the next commit). Send the output to a
  file and check the exit code.
- **Never have two modules whose names differ only by case**
  (`lateResult.js` beside `LateResult.jsx`). Windows ignores case, the
  import resolves to the wrong file, and the failure looks like anything
  but a filename.
