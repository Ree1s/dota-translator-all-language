# Dota Translator

Translates Russian Dota 2 chat into English, live, on a transparent
Electron overlay above the game. Free for players, source available,
runs on the player's own Gemini key. Windows only.

The user plays EU servers with Russian teammates who will not or cannot
use English. That is the whole point of it.

---

# WHERE THIS STANDS (2026-09-20, end of the day)

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

### 1. THE READER COSTS THE GAME FRAMES - this is the blocker

User-reported the first time the overlay was ever left running while
actually playing: *"my game seems laggy"*. Believe it; it is not
imagination.

Two causes, one avoidable:

- A **leftover scanner from testing** was running beside the overlay's
  own, so the game paid for two. Always check for strays (below).
- Even one is heavy: **~710 MB read every 2 seconds across three
  threads**, roughly 350 MB/s of memory bandwidth taken from a game that
  wants all of it, with `ReadProcessMemory` walking Dota's own address
  space to do it.

**The lesson, which is the part worth keeping:** a poll's WALL time is
not its cost to the game. 470ms looked cheap all afternoon, nothing here
had measured a frame time, and the player noticed before any number did.
Whatever is tried next, the measurement that decides it is frame time in
the game, not milliseconds in the scanner.

Three ways out, ranked by what they buy:

1. **Scan a window around where hits were seen.** Remember the addresses
   that produced lines and read a few tens of MB around them every poll,
   falling back to the whole hot allocation only every Nth poll. Cheap to
   build. Needs a live game to size the window - it is NOT known how far
   a new line lands from the last one, only that it is usually a
   different region inside the same allocation.
2. **Find the chat log container and read it directly.** A few KB per
   poll instead of scanning at all - nearly free, and the most fragile
   across patches. This is the "locate the container" step the notes have
   flagged from the start.
3. **Fewer threads, longer interval.** Lowers contention, costs latency,
   buys the least. `scanIntervalMs` and the thread count in
   `memscan.ps1` are the knobs.

### 2. Never run against the live game without asking

The game belongs to the person playing it. Do not start a scanner, the
watcher or the overlay against a running Dota without the user's say-so,
and stop everything when the measurement is done.

A scanner outlives a force-killed parent, so check for strays: list
`powershell.exe` processes whose command line contains `-File` and
`memscan`, with their `ParentProcessId`. Note that a query whose own
command line contains the word `memscan` matches its own filter - that
cost a round of confusion; matching on `-File` as well is what keeps it
honest.

**Worth fixing while you are in there:** the helper does not die with its
parent. Force-kill the node or Electron process and the PowerShell
scanner keeps reading memory forever. A clean quit (`Alt+Shift+D`) is
fine, because `watcher.stop()` kills the child. Passing the parent pid in
and having the loop exit when that process is gone would close it.

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
npm test         # 65 tests, plain node assert, no runner
```

Keep `npm test` green. It needs no game running and no API key.

- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Working branch is `master`, pushed to `KristjanRanna/dota-translator`.
- Source files are LF. There is no build step and nothing compiled.
- The Gemini key lives in `config.json` (gitignored) or `GEMINI_API_KEY`.

### Testing the reader with no Dota running

Copy `node.exe` to `fakedota.exe`, run a script that holds the chat
strings verbatim in buffers and adds a new one every few seconds, then
point the scanner at `-ProcessName fakedota` (`startMemorySource` takes a
`spawnImpl`, so nothing needs a setting for it). That found three real
faults in one sitting. **Do this before touching the live game.**

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
| a sweep, single pass vs one per anchor | 1.5s vs 8.5s per gigabyte |

Defaults are a 2s poll and a 2-minute sweep. **Those defaults are what
the user called laggy**, so treat them as an upper bound, not a target.

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

## Two traps that have each cost an hour

- **Never put a backslash escape through a bash heredoc into a patch.**
  It has silently mangled a string literal three times in this project
  and in the user's other one, twice inside the very test written to
  catch the first instance.
- **Never have two modules whose names differ only by case**
  (`lateResult.js` beside `LateResult.jsx`). Windows ignores case, the
  import resolves to the wrong file, and the failure looks like anything
  but a filename.
