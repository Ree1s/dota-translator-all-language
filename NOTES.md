# Where this stands - read this first

Written 2026-09-20, after testing against real Dota 2 on this machine.

**Short version: the app is built and works, but the way it gets chat lines
does not. Dota does not write chat to `console.log`. Everything else in the
repo is fine and reusable.**

---

## 1. The decision: free, open source, donations

No subscription, no licence key, no paid tier, no trial. Hosting cost EUR 0.

Reasons, so this is not re-argued later:

- **Translation is free.** Anyone can make a Gemini API key in two minutes
  and run on the free tier. A subscription would sell convenience only.
- **The market price is below the cost floor.** Dota Plus (Valve's own, full
  feature set) is $3.99/mo; the best-known third-party companion app (every
  skin unlocked, plus analytics) is ~$2-3 per 30 days. A single-purpose chat translator is worth maybe
  EUR 1-1.50 - under both the card-fee floor (~EUR 2 before fees stop eating
  a fifth) and the API cost of a 10-games-a-day user (EUR 1.70-2.50/mo).
- **Subscribers would be adversely selected.** Only heavy users ever hit a
  usage limit, so the paying pool is the expensive pool.
- **Nothing here is protectable.** Client-side software can only be
  protected when the valuable part lives on a server, or when it decays with
  frequent updates. This has neither: a prompt and an API call are the same
  next month. A licence check is a five-minute patch either way.
- **Free + open source buys the thing that matters most for this audience:**
  "is this a virus / will I get banned" is answerable with "read the code".

Do NOT add a hosted shared API key. With public source, the endpoint URL
and its rate limits are public too, and it would be strangers' API bills
with no revenue.

## 2. THE BLOCKER - measured, not assumed

Tested on this machine: Dota at the default Steam path, `-condebug`
confirmed in `localconfig.vdf`, in a bot match.

1. **`console.log` IS written live.** 87,666 -> 87,899 bytes in 3 seconds
   while the game ran. (The widely-cited ValveSoftware/Dota-2 issue #1634,
   "only written when the client exits", is WRONG. It is an unanswered 2019
   question that search engines restate as fact.)
2. **Chat is NOT in the log.** `PBTEST12345` typed in BOTH team and all chat
   appears nowhere, while the log grew 2 KB in the same minute. The only
   Cyrillic in the whole file is bot player names. Chat is drawn by
   Panorama, never spewed to the engine console.
3. **Console command output does not reach the log either.** The
   `Console`/`Developer` channels carry a `[ConsoleOnly]` flag. Channels
   without it (`[Server]`, `[Client]`, `RenderSystem`) do reach the file.
4. `log_dumpchannels` lists **channel 140 `DOTA_CHAT`, severity `off`, tags
   `[Chat][DotA]`, no ConsoleOnly flag** - so if it could be switched on,
   its output WOULD land in the log.
5. **It cannot be switched on.** `log_level DOTA_CHAT default`,
   `log_level 140 default` and `log_verbosity DOTA_CHAT 4` all answer
   **"Log verbosity levels are locked."** In a match AND in the main menu,
   so the lock is global. Deliberate, and consistent with the Valve update
   that disabled console commands which introspect client state.

Only `-dev` in launch options was left untried. Low odds.

## 3. What already works and is worth keeping

Nothing below cares where a chat line came from. Only the SOURCE is missing.

| File | What it does |
|---|---|
| `src/chatlog.js` | log tail (survives truncation on a new game, half-written lines), parser, Steam install lookup |
| `src/translate.js` | one batched Gemini call, tolerant of replies that are not clean JSON; a dropped line falls back to the original |
| `src/pipeline.js` | batches lines arriving together into one call; a failed translation still shows the original |
| `src/main.js` + `overlay.*` | transparent, always-on-top, click-through overlay |
| `src/doctor.js` | `npm run doctor` - no-key diagnostic, reports log growth and parsed chat |
| `src/demo.js` | `npm run demo` - fake log feeder, drives the whole chain with no game |
| `test.js` | 33 tests, plain node assert, no runner |

The **Cyrillic gate** is the load-bearing design idea: only lines containing
Cyrillic are sent to the model. It keeps cost near zero AND makes the parser
safe, because engine output is ASCII and can never pass it.

## 4. The only route left: read the chat off the screen

This is what the one maintained competitor does
(WatcherApps/GameChatTranslator - OCR + Tesseract, Python). The three tools
that read chat properly all reach into the game process and are ALL dead
(memory reading 2018, DLL injection 2017 archived, packet sniffing 2015).
They died of maintenance, not bans.

**Start with this one-hour probe, and nothing else.** Do not rebuild the app
until it answers yes:

1. Start a bot match, type Russian in chat.
2. Capture the chat region of the screen once a second.
3. Send a frame to a Gemini vision call and ask it to transcribe the chat
   lines.
4. Question to answer: **does it reliably read Cyrillic off the chat box
   before the box fades?**

If yes, the rest is: continuous capture, dedup across frames (the same line
appears in many frames), and feeding the existing pipeline. If no, stop.

`blackjackVision.js` in the paperbook repo is the nearest existing machinery
(screenshot a region, send to a vision model, parse the reply).

Known costs of this route, decided in advance: image tokens per read rather
than a few text tokens; fragile to resolution and UI scale; the chat box
fades after a few seconds so capture must be continuous.

## 5. Considered and set aside: reading the game's memory

Works, and is now plausibly auto-maintainable - `client.dll` carries named
types (`CDOTAUserMsg_ChatMessage`, `CDOTAGameChatController`), Source 2
exposes its schema at runtime, and public dumpers already auto-update per
patch via GitHub Actions for CS2.

Set aside anyway: it means reading another process's memory, Valve breaks
tools in this category deliberately, and there is no business case that
would justify the risk (see section 1).

## 6. Practical notes for whenever this restarts

**The Gemini key trap.** A key from a Google AI Studio project with billing
ENABLED does not fall back to the free tier - it fails with "prepayment
credits are depleted". A free-tier key must come from a project with **no
billing enabled**. This is also why paperbook's support desk is on its
scripted fallback. Check which project a key came from before debugging
anything else.

**Hosting is EUR 0 and should stay that way.** Public GitHub repo, Releases
for the download, README as the landing page, user's own API key, no server,
no domain, no merchant of record, no VAT.

**r/DotA2 rules (read 2026-09-20).** Self-promotion is allowed: 5 days
between promo posts, contribute in posts other than your own, and the
account must not exist solely to share your own content. There is no rule
about third-party tools or cheating at all. The one that could bite is **AI
generated content** - submissions containing AI-generated text are banned,
which is ambiguous for a screenshot of a translator's output, so write the
post yourself. Asking for money needs "proof of a history of created content
or value for the community" first, so ship free before adding a donate link.

**Commands**

```
npm test           # 33 tests
npm run doctor     # diagnose the log, no API key needed
npm run demo       # fake log feeder, drives the overlay with no game
npm run watch      # the whole chain in a terminal
npm start          # the overlay (Electron)
```

---

**2026-09-20, later the same day: THE BLOCKER IS GONE.** Memory reading
works - chat sits in Dota's memory as complete, pre-formatted UTF-8 strings,
found in a 11s scan with no offsets, schema or injection. Sections 2 and 4
above are superseded in their CONCLUSION (every measurement still stands).
See **`NOTES-2026-09-20-memory.md`**, which also records the accepted ban
risk, why the old tools really died, and the vision/OCR results.
