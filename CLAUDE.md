# Dota Translator

Translates Russian Dota 2 chat into English, live, on a transparent
Electron overlay above the game. Free for players, source available,
runs on the player's own Gemini key. Windows only.

The user plays EU servers with Russian teammates who will not or cannot
use English. That is the whole point of it.

## Read these first

- `NOTES-2026-09-20-memory.md` - the memory-reading route, the decisions
  already made, and what is measured. **It supersedes NOTES.md's
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
- Working branch is `master`, pushed to
  `KristjanRanna/dota-translator`.
- Source files are LF. There is no build step and nothing compiled.
- The Gemini key lives in `config.json` (gitignored) or `GEMINI_API_KEY`.

## How it works

`src/memscan.ps1` reads the running game's memory and prints one JSON
object per line it finds; `src/memsource.js` keeps that helper alive and
turns its findings into `{name, text, channel}`; `src/chatmem.js` decides
what is a real line; `src/pipeline.js` batches; `src/translate.js` makes
one Gemini call; `src/main.js` + `overlay.*` draw it.

**Nothing downstream of the source cares where a line came from.**
`src/watcher.js` (the old `console.log` reader) is kept for that reason,
though it cannot see chat - see below.

### Facts that cost real time to establish

- **Dota keeps each chat line complete and pre-formatted** as one
  null-terminated UTF-8 string, and a second time as Panorama markup
  carrying the player's colour slot. Nothing has to reassemble fields.
- **All-chat has NO channel tag.** Team chat is `[Allies] name: text`;
  all-chat is just `name: text`, which is far too common a shape to scan
  4 GB for. So the anchor is `class="ChatPersona"` (the markup form,
  which every channel has) and the channel is read from what precedes
  it. Anchoring on the tag read team chat perfectly and missed every
  word of all-chat, silently.
- **Some hits are freed or half-overwritten memory.** A hit is
  validated, never trusted.
- **The first sweep only PRIMES**, so starting mid-match does not dump
  the backlog on screen.
- **The Cyrillic gate is load-bearing**: only lines containing Cyrillic
  are translated, which keeps cost near zero and keeps Dota's own
  localised chat wheel ("Pushing mid") out of the model.
- **The hot set is ALLOCATIONS, not regions, and that is the whole
  trick.** MEASURED in a live match: a new chat line does NOT land in the
  region the last sweep found one in - over 95 polls of hot regions, not
  one new line appeared, and both times chat turned up it was a full
  sweep that found it. It does land in the same heap RESERVATION. Polling
  those is ~710 MB of a 7.5 GB process.
- **MEASURED against the live game (2026-09-20):** full sweep **3.8s over
  7,463 MB / 7,213 regions**; poll **410-780ms over ~710 MB**. Reading is
  done on up to three threads - it is memory bandwidth as much as
  processor, and a poll that eats a core costs frames in the game it is
  reading.
- The scan is **one pass** over the buffer gated on a `bool[256]` of
  bytes that can start an anchor. It used to be one pass per anchor -
  seven passes over everything, six times slower.
- **Regions bigger than the buffer used to be skipped whole**: 20 of
  them, 2,972 MB, two fifths of the process, silently. They are read in
  overlapping chunks now, and a string running to a seam is left to the
  next chunk rather than emitted truncated.
- A poll skips regions over 64 MB (the chat allocations also hold the
  game's bulk pools, ~2 GB of them). That is a heuristic; the full sweep
  is the thing with none in it.
- While there is nothing to find, fruitless sweeps **back off 1s to
  10s** rather than running back to back.
- **A call to the model that never arrived is made once more.** On the
  first live game this ever read, one of two lines timed out at 12s.

### Routes that are dead, with the measurement

Do not revisit these without reading the notes; a web search will tell
you the first two are open questions, and they are not.

- **`console.log` carries no chat.** The log is written live (the
  widely-cited issue saying otherwise is wrong), but chat is drawn by
  Panorama and never reaches the engine console.
- **`DOTA_CHAT` verbosity is LOCKED.** `log_level DOTA_CHAT default`
  answers "Log verbosity levels are locked", in a match and in the menu.
- **GSI carries no chat.** Map, hero, items, abilities, draft. No
  messages.
- **Vision works and costs too much** - exact Cyrillic transcription,
  ~1,200 calls a game, which exhausts the free tier in one match.

## Decisions already made - do not re-litigate

- **Ban risk is accepted by the user, explicitly.** Ship at their own
  risk with a clear notice. Word it as *undocumented*, never *safe*.
  Compare to **Overplus**; never to Overwolf, which Valve permits and
  which does not read memory.
- **Licence is PolyForm Noncommercial 1.0.0** - free for players, a paid
  product may not bundle it. That makes this **source-available, not
  open source**; do not call it open source.
- **Replacing the chat text in place is WANTED, as an option**, after
  the overlay. Argued against once on risk; the user's answer stands.
- Free, own key, donations. No subscription and **no hosted shared API
  key** - with public source that would be strangers' bills.

## Testing the reader with no Dota running

Copy `node.exe` to `fakedota.exe`, run a script that holds the chat
strings verbatim in buffers and adds a new one every few seconds, then
point the scanner at `-ProcessName fakedota` (`startMemorySource` takes
a `spawnImpl`, so nothing needs a setting for it). That found three real
faults in one sitting.

`npm test` also parses every `.ps1` through PowerShell's own parser,
with a deliberately broken script as a control first. The scanner is one
file that nothing else would notice being broken: a syntax error there
is not an error anybody sees, it is a tool that silently never reads a
line.

## What has been seen working, and what has not

**It has translated a real game (2026-09-20).** In a live bot match, typed
Russian went from the game to the terminal: `давай рошан` -> "let's do
roshan" as `[team]`, and `я иду топ, помогите` read correctly as `[all]`
(shown untranslated - that was the call that timed out, which is what the
retry above is for) - so the all-chat anchor is right on the real thing
too, and the backlog was primed away as intended. A poll (not a sweep) was the first to see two
new lines, which is what the allocation-level hot set was built for.

Not seen:

- **The overlay over the real game.** The chain above was `npm run watch`.
- **A whole match.** Whether the hot allocations stay the right ones over
  40 minutes, and what happens across two matches in one process launch.
- Spectator and coach channel tags are guesses. An unknown tag is
  reported and written to `learn.log` rather than failing silently.
- Replacing text in place - not started.
