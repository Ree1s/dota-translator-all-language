# Dota Translator

Reads Dota 2's chat out of the game's own console log, translates anything
written in Cyrillic into English with Gemini, and shows it on a transparent
overlay above the game.

Nothing touches the Dota process. The game writes `console.log` itself when
started with `-condebug`, an official Valve launch option, and this only
reads that file. No injection, no memory reading, nothing VAC objects to.

## Setup

1. **Turn the log on.** Steam library, right click Dota 2, Properties,
   Launch Options, add:

   ```
   -condebug
   ```

2. **Run Dota borderless windowed.** Settings, Video, Display Mode. An
   exclusive fullscreen game owns the screen and no overlay can sit on it.

3. **Get a Gemini key** at https://aistudio.google.com/apikey - free tier.
   Make it in a project with **no billing enabled**; a project with prepay
   billing turned on does not fall back to the free tier, it just fails.

4. **Configure:**

   ```bash
   cp config.example.json config.json
   ```

   Paste the key into `geminiApiKey`. Or set `GEMINI_API_KEY` in the
   environment instead, which wins over the file, so the key need never be
   written to disk.

5. **Install and run:**

   ```bash
   npm install
   npm start
   ```

## Two ways to run it

- `npm start` - the overlay.
- `npm run watch` - the same chain printed to a terminal, no Electron. Use
  this first: it proves the log is being read and the key works, without
  the window getting in the way.

## Keys

- `Alt+D` hides and shows the overlay.
- `Alt+Shift+D` quits.

## Settings (`config.json`)

| key | what it does |
|---|---|
| `geminiApiKey` | your key. `GEMINI_API_KEY` in the environment wins over it |
| `model` | `gemini-3.5-flash-lite` by default |
| `logPath` | blank finds the Steam install. Set it if auto-detection fails |
| `scripts` | which writing systems to translate. `["cyrillic"]` by default; `greek`, `han`, `hangul`, `arabic`, `thai` are also known |
| `batchMs` | how long to gather lines before one call (400) |
| `holdSeconds` | how long a line stays on screen (14) |
| `maxLines` | how many lines the overlay holds (6) |
| `showOriginal` | print the Russian under the English (true) |
| `position` | `top-left`, `top-right`, `bottom-left`, `bottom-right` |
| `clickThrough` | clicks pass through to the game (true) |
| `learn` | write unrecognised foreign lines to `learn.log` - see below |

## What it costs

Only lines containing Cyrillic are sent, and lines arriving together go in
one call. A normal game is a handful of calls with a few dozen short lines.
That sits inside the Gemini free tier with room to spare.

## If chat is not picked up

A chat line in the log looks like `Name: message`, and that is what
`parseChatLine` expects. If a Dota update changes the shape, set `"learn":
true` in `config.json` and play a game: every line carrying a script you
cannot read that the parser did **not** take as chat is appended to
`learn.log`. That file is the answer to what the format became.

The script gate is what keeps the parser honest the rest of the time - the
engine's own output is ASCII, so it can never be mistaken for Russian chat
however odd a line looks.

## Testing

```bash
npm test
```

Plain Node assert, no runner. Covers the parser, the tail (including the
log being truncated on a new game and a half-written line), the Gemini
request and reply, the batching, and the config merge, and checks that
every script in `src/` parses.
