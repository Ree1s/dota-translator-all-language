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

**This reads Dota's memory, and Valve has said that applications which
read the Dota client can get an account permanently banned.** Be honest
with yourself about that before running it.

What it actually does: opens the Dota process with `PROCESS_VM_READ |
PROCESS_QUERY_INFORMATION` - permission to read and to ask questions - and
copies out the chat lines. It **never** calls `WriteProcessMemory`. Nothing
is injected, nothing in the game is changed, and no file of Dota's is
touched. You can check all of that yourself: it is one file,
[`src/memscan.ps1`](src/memscan.ps1), and it is plain text.

One more thing, and only if you use it: when you press `Ctrl+Enter` in the
game's chat to [send a line translated](#saying-something-back), the app
presses a few keys for you (select, copy, paste, Enter), through Windows,
as a macro key would. That is input, not memory - it is also one file,
[`src/sendchat.ps1`](src/sendchat.ps1) - and Valve has not said anything
about that either. `"sayHotkey": ""` turns it off.

What Valve has said, and what nobody can tell you:

- **In February 2023 Valve [banned over 40,000 accounts](https://www.dota2.com/newsentry/3677788723152833273)**
  for cheat software that read hidden data out of the Dota client, caught
  by a trap: a piece of memory that normal play never reads. In the same
  post it wrote that running any application that reads data from the
  client while you play can get your account "permanently banned". Those
  tools read what players are not meant to see. This one reads the chat
  that is already on your screen and gives no advantage - **but Valve's
  sentence makes no exception for that**, and a tool that reads memory
  cannot promise it never touches a trap.
- **No ban is known for a tool like this one.** That is not the same as it
  being safe. It means nobody has reported one, which is a weaker claim.
- **The direct question got no answer.** Whether reading what the client
  already shows you is allowed was
  [asked](https://github.com/ValveSoftware/Dota2-Gameplay/issues/15007)
  in January 2024. Nobody from Valve replied; a bot closed it as stale in
  August 2025.
- The claim that read-only access is undetectable comes from the
  reverse-engineering community, not from Valve, and those same sources say
  it is not a guarantee.
- The Steam Subscriber Agreement makes any third-party tool a violation
  whatever technique it uses.

The honest way to think of it: an **unsanctioned third-party tool**, the
kind that works, that plenty of people use, and whose users carry the risk
themselves. It is *not* one of the overlays Valve permits - those do not
read the game's memory, and this does.

**Use it at your own risk, and not on an account you would mind losing.**

What the program does on your PC, how to check the download against the
source, and how to report a problem: [SECURITY.md](SECURITY.md).

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

2. **Get a Gemini key** at <https://aistudio.google.com/apikey> - there is a
   [step-by-step guide with pictures](https://sc0rebreaker.github.io/dota-translator/key.html)
   ([source](docs/key.html)). The free
   tier is plenty. Two traps, both of which cost an hour to find:
   - Make it in a project with **no billing enabled**. A project with prepay
     billing does *not* fall back to the free tier; it fails outright with
     *"prepayment credits are depleted"*.
   - A brand-new project can answer **403 "Your project has been denied
     access"** on every model while still happily listing them. If that
     happens, make the key in a different project.

3. **Install it.** [Download `Dota-Translator-Setup.exe`](https://github.com/sc0rebreaker/dota-translator/releases/latest/download/Dota-Translator-Setup.exe)
   (always the latest release) and run it. It installs for your user only (no
   administrator needed), adds a shortcut and starts the app. The installer
   is not code-signed, so Windows SmartScreen asks first: *More info*, then
   *Run anyway*.

   From source instead: `npm install`, then `npm start`. `npm run dist`
   builds the installer into `dist/`.

4. **Paste your key into the window that opens.** The first time, the app
   asks for it: paste, press **Check and save**, and it tries the key with
   one real translation before saving it, so you know it works - or says in
   plain words why it does not. The key is stored on your PC only, encrypted
   by Windows for your user. The same window is behind the tray icon later,
   for changing the key or where the translations appear.

   Prefer files? `cp config.example.json config.json` and put the key in
   `geminiApiKey`, or set `GEMINI_API_KEY` in the environment, which wins
   over both and never touches the disk. `npm run watch` (the terminal
   mode) needs one of those two: it cannot read the encrypted key.

`-condebug` is **not** needed. That was for the old log reader.

## Ways to run it

- `npm start` - the overlay.
- `npm run watch` - the same chain printed to a terminal, no Electron. Use
  this first: it proves the game is being read and the key works, without a
  window in the way.
- `npm run demo` - drives the whole chain from a fake source, with no Dota
  running at all.

## Above the game's own chat

By default the translated lines appear just above Dota's chat, in the same
type and lined up with it, as `name: english (what was said)` - each one
the moment it is said, in Russian, turning into English about a second
later. Nothing is drawn over the game's own lines. The overlay hides
itself whenever Dota is not the window in front.

`"display": "cover"` is the other way: the English goes where the line already is: over each line of
Dota's own chat, as `name: english (what was said)`, with the hero portrait
left showing. Lines that were English already are left alone. Nothing in the
game is changed to do this - it is still a window drawn over the game; it
reads where Dota has put its chat and lays each strip on its line. Dota
fades a chat line after about five seconds; the English stays for
`holdSeconds`. Measured on one screen (5120x1440). If the strips sit
slightly off on yours, set `"display": "box"` and say so in an issue.

## The chat box

A second chat box, drawn over the game right above Dota's own: the same
lines, in English, with the channel and the player's colour. A line appears
in it the moment it is said - as written, dimmed - and turns into English
where it stands about a second later, with the original kept small beneath
it. Measured over two bot matches, 24 lines: on screen in about 0.2
seconds, in English in about 1.1, never more than 1.4. A line somebody has
said before comes out of memory at once and costs no call.

While nothing is being said the box is not drawn at all, the window costs
no processor time, and reading the chat costs about 0.3% of one core.

## Keys

- `Alt+D` hides and shows the overlay.
- `Alt+Shift+D` quits.
- `Ctrl+Enter`, in Dota's chat, sends what you typed translated (below).

## Saying something back

Open the game's chat as you always do (`Enter`, or `Shift+Enter` for all
chat), type what you want to say in English, and press **`Ctrl+Enter`
instead of `Enter`**. About a second later it is said, in their language.
Plain `Enter` still sends exactly what you typed.

- **How: the app presses keys for you, and you should know that it does.**
  `Ctrl+A`, `Ctrl+C` to take what you typed; then, with the translation,
  `Ctrl+A`, `Ctrl+V`, `Enter`. They go through Windows, as a keyboard's or
  a macro key's do. It happens once, when you press the key, and never
  unless Dota is the window in front. How Valve regards that is
  undocumented, like the rest of this: at your own risk.
  `"sayHotkey": ""` turns it off, and then the app sends no keys at all.
- **Nothing is written to the game's memory, for this or for anything.**
  The app opens the game to read it and for nothing else, and `npm test`
  fails if that ever changes.
- **It goes the other way too.** In the settings window, "Your own messages"
  can be set to *Russian -> English*: type Russian and your teammates read
  English. Same key; the choice is saved as you click it.
- The language is whatever the others were last seen typing in - the app
  reads their chat, so it knows - and Russian until anybody has typed.
  `replyLanguage` in `config.json` fixes it (`"Ukrainian"`).
- If the translation fails, NOTHING is sent: your line is still in the
  chat, and the overlay says why. Your clipboard is put back afterwards.
- The model needs most of a second: it is for "buy wards" and "I'm going
  top", not for a call in the middle of a fight.
- Each new line is one call on the same free 15 a minute as the incoming
  chat. A line you have said before costs nothing.
- **The same English is always the same line.** A model asked twice answers
  two ways, so the first answer is kept, in `said.json` beside your
  settings. It is plain text: if somebody who speaks the language tells you
  a line is off, correct it there.
- With the chat CLOSED the key finds nothing to copy and says nothing -
  but the game does see a `Ctrl+A` and a `Ctrl+C`, whatever you have
  bound to those.

## Settings (`config.json`)

| key | what it does |
|---|---|
| `geminiApiKey` | your key. `GEMINI_API_KEY` in the environment wins over it |
| `model` | `gemini-3.5-flash-lite` by default |
| `source` | `memory` reads the game. `log` is the old console.log reader, which cannot see chat |
| `offsetsUrl` | where the app fetches `offsets.json` from when it starts - the few numbers that say where Dota keeps its chat, which a Dota patch can move. Fetching them means a patch is fixed for everybody by one change to that file, with nothing to reinstall. `""` never fetches and uses the copy that came with the app |
| `chatPanel` | read the game's own chat list - a few KB, four times a second - instead of searching its memory for chat. The searching below only happens until the list is found, or if it cannot be (true) |
| `panelIntervalMs` | how often to read the chat list (250) |
| `scanIntervalMs` | how often to re-read the chat when searching (1000) |
| `fullRescanMs` | how often to sweep the whole process again (120000) |
| `scanWindowMb` | most re-reads only look this many MB either side of where chat was last seen; 0 reads everything every time (4) |
| `scanWideCapMb` | the biggest memory region the look-everywhere re-read will open, in MB; 0 opens them all, 64 is lighter on the PC and can miss an all-chat line for a long time (0) |
| `scanWideEvery` | every Nth re-read looks everywhere chat has ever been, to catch a line written somewhere new (5) |
| `scripts` | which writing systems to translate. `["cyrillic", "han"]` by default - Russian, which is what this is built for, and Chinese, because so many pasted voice lines are. `greek`, `hangul`, `arabic` and `thai` are also known |
| `callsPerMinute` | how many calls a minute your key allows. The free tier is 15. The busier the chat, the more lines share one call, so a loud game stays inside it (15) |
| `batchMs` | how long to gather lines before one call (80) |
| `holdSeconds` | how long a line stays on screen (14) |
| `fadeWithGame` | in `above` mode a translated line disappears when Dota's own line does, about 7 seconds after it is said, and `holdSeconds` is ignored. `false` keeps it for `holdSeconds` (true) |
| `maxLines` | how many lines the overlay holds (6) |
| `showHeroes` | the speaker's hero portrait before their name, as Dota's chat has it. The pictures are the game's own, read from your Dota install on disk; only if one cannot be read there is it fetched from Valve's public image server instead. `false` shows and fetches none (true) |
| `showOriginal` | show what was actually said, in brackets after the English: `go mid (иди мид)`. Nothing is added when the line was English already (true) |
| `display` | `above` (the default): the translated lines as plain outlined text, like the game's own, directly above Dota's chat - placed from where the game says its chat is, so there is nothing to position. `box`: a dark panel in a corner (see `position`). `cover` lays the English over each line of Dota's own chat, exactly where the line is: `go mid (иди мид)`. It reads where the chat is from the game, so there is nothing to position. `box` draws a separate chat box instead (see `position`). `replace` - the English written into Dota's own chat line - is planned and not built; it falls back to the box |
| `position` | where the chat box goes. `chat` (the default) is directly above Dota's own chat, growing upwards; or a corner: `top-left`, `top-right`, `bottom-left`, `bottom-right` |
| `boxX`, `boxY` | put the box anywhere instead: fractions of the screen from its top-left, e.g. `0.02` and `0.5`. `-1` (the default) leaves it to `position` |
| `boxWidth` | how wide the box is, in pixels (520) |
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

**It reads the chat list itself where it can.** Dota's HUD keeps its chat
as a list of lines (a UI panel called `ChatLinesPanel`). Once that list is
found - one search of the game's memory, about ten seconds, at low
priority - reading chat is a few kilobytes four times a second, and a line
is on its way to the translator a fraction of a second after it is said.
Measured in a bot match: 12 lines of 12, team and all chat, 0.06 to 0.29
seconds each. Where the list sits inside the game is not documented and
can move in any patch, so everything read is checked, and if the check
fails the app goes back to the slower method below on its own.

**The slower method: searching for the chat.** A full sweep reads every
committed page Dota has - 7.5 GB in a real match
- which takes about 3.8 seconds across three threads. Far too slow to
poll, so the first sweep learns which **allocations** hold chat and after
that only those are read: ~710 MB in under half a second.

Allocations, not regions, and that distinction is the whole trick. A new
chat line does *not* land in the same region the last one did - measured
over 95 polls of the hot regions, not one new line ever appeared in them -
but it does land in the same heap reservation, which is a twentieth of the
process rather than a two-hundredth.

While there is no chat to be found at all - the menu, the loading screen,
a match where nobody has spoken - the sweeps back off to one every ten
seconds rather than running back to back.

The first sweep of a match only **primes**: it remembers what has already
been said without showing it, so starting the app mid-game does not dump the
whole match onto your screen at once.

## When a Dota update breaks it

It has not happened yet, so this is the plan rather than a record.

The quick way of reading chat depends on a handful of numbers that say where
Dota keeps its chat in memory. They belong to Dota's interface engine, not to
gameplay, so an ordinary balance patch should leave them alone; a bigger engine
update might move them. How often that will be, nobody knows yet.

If it happens, the app does not stop. It falls back to a slower way of finding
chat that needs none of those numbers: translations arrive a few seconds late
instead of at once, it uses noticeably more processor, and they appear in a
dark box in the corner rather than above Dota's chat, without hero portraits.

The fix is usually one small file, [`offsets.json`](offsets.json), which the
app downloads from this repository every time it starts. Once it is corrected
here, everybody has the fix the next time they open the app, with nothing to
reinstall. If a Dota update changes more than the numbers, the fix is a new
version instead, and an installed copy updates itself.

If you see the dark box and the delay after a Dota update,
[open an issue](https://github.com/sc0rebreaker/dota-translator/issues) - that
is currently the only way anybody finds out.

## If chat is not picked up

**If the overlay says Dota is running as administrator:** Windows does not
let a normal program read an elevated one. It almost always means Steam was
started with "Run as administrator". Close Steam and start it normally - or,
if you need Steam elevated, start Dota Translator as administrator too.

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

## Supporting it

It is free and stays free. If it helped and you feel like it:
[ko-fi.com/sc0rebreaker](https://ko-fi.com/sc0rebreaker). Donors get nothing
extra - there is nothing extra to get.

## Licence

**[PolyForm Noncommercial 1.0.0](LICENSE.md)** - free for players, not for
products.

In plain terms:

- **If you play Dota, it is yours.** Use it, change it, share it, fork it,
  build on it. You owe nothing and there is nothing to sign up for.
- **If you sell software, you need permission.** A paid tool cannot bundle
  this as a feature - not a subscription app, not an overlay platform, not
  anyone else charging for it. Ask, and we can talk.
- Charities, schools, research and public bodies are covered as
  noncommercial, whatever funds them.

This is **source-available**, not open source in the OSI sense - that
definition requires allowing commercial use, and this deliberately does not.
Calling it open source would be wrong, so it is not called that here.

Note what the licence does *not* restrict: your own use is noncommercial
whether or not you happen to stream, and nothing here limits fair use.

No subscription, no licence key, no paid tier and no hosted API key - you
bring your own, which is why this costs nothing to run and nothing to host.
