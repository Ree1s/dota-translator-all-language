# Dota Translator

Translates Russian Dota 2 chat into English, live, on a transparent overlay
above the game. Free for players, source available, and it runs on your own
Gemini key - no account, no server, nothing to sign up for.

```
[all]  unc status: hello everyone
       привет всем
[team] Иван: go mid
       иди мид
```

## Read this before you install it

**This reads Dota's memory, and Valve has never said whether that is
allowed.** Be honest with yourself about that before running it.

What it actually does: opens the Dota process with `PROCESS_VM_READ |
PROCESS_QUERY_INFORMATION` - permission to read and to ask questions - and
copies out the chat lines. It **never** calls `WriteProcessMemory`. Nothing
is injected, nothing in the game is changed, and no file of Dota's is
touched. You can check all of that yourself: it is one file,
[`src/memscan.ps1`](src/memscan.ps1), and it is plain text.

What nobody can tell you:

- **There is no documented case of a VAC ban for reading Dota's memory
  read-only.** That is not the same as it being safe. It means nobody has
  reported one, which is a weaker claim.
- **Valve has never answered the question.** It was
  [asked directly](https://github.com/ValveSoftware/Dota2-Gameplay/issues/15007)
  in January 2024 and closed without a reply.
- The claim that read-only access is undetectable comes from the
  reverse-engineering community, not from Valve, and those same sources say
  it is not a guarantee.
- The Steam Subscriber Agreement makes any third-party tool a violation
  whatever technique it uses.

The honest comparison is **Overplus** - unsanctioned, widely used, works
anyway, and its users accept the risk. It is *not* comparable to Overwolf,
which Valve permits and which does not read memory.

**Use it at your own risk, and not on an account you would mind losing.**

## Why memory, and not something gentler

Every other route was tried first, and measured:

- **`console.log` does not contain chat.** Dota draws chat with Panorama and
  never sends it to the engine console. Tested with `-condebug` on, in a
  match: the log grew 2 KB while a typed test message appeared nowhere in it.
- **The `DOTA_CHAT` log channel cannot be switched on.** It exists, with the
  right tags and no console-only flag, but `log_level DOTA_CHAT default`
  answers **"Log verbosity levels are locked"** - in a match and in the main
  menu alike.
- **Game State Integration carries no chat.** It sends map, hero, items,
  abilities, buildings, draft and wearables. No messages of any kind.
- **Reading the screen works, but not for free.** A vision model transcribes
  Cyrillic off the chat box perfectly; it also costs roughly 1,200 API calls
  a game, which exhausts the free tier in a single match. Plain Tesseract
  misreads the text over Dota's bright terrain.

[NOTES.md](NOTES.md) and
[NOTES-2026-09-20-memory.md](NOTES-2026-09-20-memory.md) hold the full
measurements.

## Setup

You need Windows and Dota 2. There is no installer and nothing compiled -
the memory reading runs through PowerShell, which Windows already has.

1. **Run Dota borderless windowed.** Settings, Video, Display Mode. An
   exclusive fullscreen game owns the screen and no overlay can sit on it.

2. **Get a Gemini key** at <https://aistudio.google.com/apikey> - the free
   tier is plenty. Two traps, both of which cost an hour to find:
   - Make it in a project with **no billing enabled**. A project with prepay
     billing does *not* fall back to the free tier; it fails outright with
     *"prepayment credits are depleted"*.
   - A brand-new project can answer **403 "Your project has been denied
     access"** on every model while still happily listing them. If that
     happens, make the key in a different project.

3. **Configure:**

   ```bash
   cp config.example.json config.json
   ```

   Paste the key into `geminiApiKey`. Or set `GEMINI_API_KEY` in the
   environment, which wins over the file, so the key need never be written
   to disk.

4. **Install and run:**

   ```bash
   npm install
   npm start
   ```

`-condebug` is **not** needed. That was for the old log reader.

## Ways to run it

- `npm start` - the overlay.
- `npm run watch` - the same chain printed to a terminal, no Electron. Use
  this first: it proves the game is being read and the key works, without a
  window in the way.
- `npm run demo` - drives the whole chain from a fake source, with no Dota
  running at all.

## Keys

- `Alt+D` hides and shows the overlay.
- `Alt+Shift+D` quits.

## Settings (`config.json`)

| key | what it does |
|---|---|
| `geminiApiKey` | your key. `GEMINI_API_KEY` in the environment wins over it |
| `model` | `gemini-3.5-flash-lite` by default |
| `source` | `memory` reads the game. `log` is the old console.log reader, which cannot see chat |
| `scanIntervalMs` | how often to re-read the chat (1000) |
| `fullRescanMs` | how often to sweep the whole process again (60000) |
| `scripts` | which writing systems to translate. `["cyrillic"]` by default; `greek`, `han`, `hangul`, `arabic`, `thai` are also known |
| `batchMs` | how long to gather lines before one call (400) |
| `holdSeconds` | how long a line stays on screen (14) |
| `maxLines` | how many lines the overlay holds (6) |
| `showOriginal` | print the Russian under the English (true) |
| `position` | `top-left`, `top-right`, `bottom-left`, `bottom-right` |
| `clickThrough` | clicks pass through to the game (true) |
| `learn` | write unrecognised lines to `learn.log` - see below |

## What it costs

Almost nothing. Only lines containing Cyrillic are sent, and lines arriving
together go in one call, so Dota's own chat wheel ("Pushing mid", already in
your language) never costs anything at all. A normal game is a handful of
calls carrying a few dozen short lines - well inside the free tier.

Reading the screen instead would have cost roughly 1,200 calls a game.
Reading memory is the reason this is free.

## How it finds the chat

Worth knowing if you are reviewing the code:

Dota keeps each chat line complete and already formatted, as one UTF-8
string. It also keeps Panorama's markup copy, which carries the player's
colour. The markup is what this anchors on, because **all-chat has no
channel tag**: team chat reads `[Allies] name: text` while all-chat is just
`name: text`, which is far too common a shape to search 4 GB for.

A full sweep of the process costs about 1.5 seconds per gigabyte, and Dota
is four to five of them - too slow to poll. So the first sweep learns
*which regions* hold chat, and after that only those are read, which is
tens of milliseconds over a handful of regions. The whole process is swept
again every `fullRescanMs`, because the game keeps allocating.

While there is no chat to be found at all - the menu, the loading screen,
a match where nobody has spoken - the sweeps back off to one every ten
seconds rather than running back to back.

The first sweep of a match only **primes**: it remembers what has already
been said without showing it, so starting the app mid-game does not dump the
whole match onto your screen at once.

## If chat is not picked up

Set `"learn": true` in `config.json` and play a game. An unrecognised chat
channel is written to `learn.log`, and that file is the answer to what
changed.

Only `[Allies]` and untagged all-chat are confirmed against a real game.
Spectator and coach chat are guesses; if one of them is wrong it will show
up in that log rather than failing silently.

## Testing

```bash
npm test
```

Plain Node assert, no runner. 62 tests, none of which need Dota running: the
parsers are fed strings taken verbatim out of the game's memory, and the
whole reading chain runs against a stand-in for the scanner.

## Licence

**[PolyForm Noncommercial 1.0.0](LICENSE.md)** - free for players, not for
products.

In plain terms:

- **If you play Dota, it is yours.** Use it, change it, share it, fork it,
  build on it. You owe nothing and there is nothing to sign up for.
- **If you sell software, you need permission.** A paid tool cannot bundle
  this as a feature - not Overplus, not Overwolf, not anyone else charging
  for it. Ask, and we can talk.
- Charities, schools, research and public bodies are covered as
  noncommercial, whatever funds them.

This is **source-available**, not open source in the OSI sense - that
definition requires allowing commercial use, and this deliberately does not.
Calling it open source would be wrong, so it is not called that here.

Note what the licence does *not* restrict: your own use is noncommercial
whether or not you happen to stream, and nothing here limits fair use.

No subscription, no licence key, no paid tier and no hosted API key - you
bring your own, which is why this costs nothing to run and nothing to host.
