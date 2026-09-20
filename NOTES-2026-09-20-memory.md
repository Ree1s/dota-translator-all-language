# 2026-09-20 (later the same day): the blocker is GONE - memory reading works

Read this with `NOTES.md`. Every measurement in that file still stands;
its **conclusion** (sections 2 and 4 - "the only route left is OCR") is
superseded by this one.

## What was decided

**Ban risk is accepted, by the user, explicitly.** Ship at the user's own
risk with a clear notice, in the same category as Overplus. This reopens
the memory-reading route that `NOTES.md` section 5 had set aside on risk
alone.

Word the notice carefully:

- **Do NOT cite Overwolf as precedent.** Overwolf is a sanctioned overlay
  framework that games support and that does not read process memory.
  Overplus is the fair comparison.
- Say the risk is **undocumented**, not **safe**. See the VAC section.

**The licence is PolyForm Noncommercial 1.0.0** (the user's call): free for
players, and a paid product may not bundle it - Overplus and Overwolf were
named as exactly what this is meant to prevent. Three things follow:

- **This is SOURCE-AVAILABLE, not open source.** Every OSI licence permits
  commercial use, so "free for everyone but not for paid products" cannot
  be open source by that definition. NOTES.md section 1 says "open source"
  throughout; its REASONING still holds (readable code is what answers "is
  this a virus"), but the word is wrong and the README avoids it.
- GPL would not have helped. It does not stop a paid product using this,
  it only forces them to publish their changes - weak leverage over a
  bundled feature.
- A licence only deters someone who cares about legal exposure. That is
  exactly who Overplus and Overwolf are, which is why it is worth having.

**REPLACING the chat text in place is WANTED, as an option** (the user's
preference over a second chat box). It was argued against once on risk -
reading is passive, writing is what VAC scans for - and the user's answer
stands and is reasonable: **Overplus writes to the client** (its Inventory
Changer does exactly that), its users are broadly fine, and the last ban
wave was years ago. So this is a decision, not an open question. Default
to the overlay, make replace opt-in.

**Replace is harder to BUILD than the overlay, independent of risk**, and
these are the two reasons, both visible in the dump above:

- The translation is usually longer than the original, so it will not fit
  the existing allocation. Writing past it needs the length field or the
  surrounding container, not just the string.
- The text exists in **two** representations (plain formatted string and
  Panorama markup). Panorama re-renders from its own data, so which buffer
  is written, and when, decides whether the change appears at all or is
  simply overwritten back.

Sequencing, for that reason and not for safety: **overlay first** (its
pipeline is already built and tested), **replace second**, once it is known
which buffer the renderer actually reads. The reading work is identical
either way, so nothing is wasted. An overlay also keeps the original
visible beside the translation, which is worth something when machine
translation of Dota slang gets it wrong - worth offering even once replace
exists.

## MEASURED: Dota keeps chat in memory as plain readable strings

Tested against the live game. `OpenProcess` with `PROCESS_VM_READ |
PROCESS_QUERY_INFORMATION`, a `VirtualQueryEx` walk, `ReadProcessMemory`,
byte scan. No admin rights, no injection, no offsets, no schema, no
symbols. Scanners kept in the scratchpad as `scan2.ps1` / `dump.ps1`.

**The scan loop must be compiled C# via `Add-Type`** - a PowerShell byte
loop over 4 GB never finishes.

1. **A full scan of the whole 4.6 GB process takes 11.1 seconds.** A
   targeted scan hit its 60-result cap in 3.6s over 469 MB.
2. **The chat line is stored COMPLETE and PRE-FORMATTED**, as one
   null-terminated UTF-8 string:

   ```
     [Allies] unc status: не фидите, у них варды на руне
   ```

   Channel tag, name, `: `, message. `chatlog.js`'s existing parser was
   written for almost exactly this shape.
3. **A second representation is Panorama's own markup**, carrying the
   player colour and slot:

   ```
   [Allies] <span class="ChatPersona"><span class="PlayerColor4">
   <font color='#FF6B00'>준우</font></span></span>: I'm retr...
   ```
4. Scanning for the literal `[Allies] ` found 40 hits across the process.
   **Some are freed or partial memory** - truncated strings, garbage after
   the tag - so an implementation must validate a hit, never trust it.
5. **A false lead, recorded so it is not re-derived:** `unc status` and
   `не фидите` sit at a consistent +0x0C from each other, which looks like
   a name/text struct. It is not. `unc status: ` is 12 characters. It is
   one string.

**Why this beats everything else:** exact text (no OCR errors), no fade
window, no per-frame API cost, no free-tier limit, resolution-independent,
no calibration. It removes every blocker found today.

**Done since, in `src/memscan.ps1` + `src/chatmem.js`:**

- **Polling is cheap.** The first sweep learns which REGIONS held a hit
  and after that only those are read. Measured on the stand-in below: a
  full sweep 244ms over 170 MB, a poll 40ms over 7 MB.
- **The sweep is one pass, not seven.** It scanned every byte once per
  anchor. Gated on a `bool[256]` of bytes that can start one, it is six
  times faster and steady: on a 1 GB process, 10.6/8.5/6.0s before,
  1.46/1.47/1.48s after - about **1.5 seconds per gigabyte**. The old and
  new scanners were run against the same live process and returned byte
  for byte the same ten strings, so this is proved equal rather than
  assumed.
- **Nothing is swept when there is nothing to find.** Two faults did the
  opposite: an empty hot set fell through the region filter and read the
  WHOLE process (a "quick" scan costing 8.3s over 1 GB), and
  `$hot.Count -eq 0` forced a full sweep every turn - so the menu, the
  loading screen and a match before anyone speaks each kept a core busy
  for as long as they lasted. Fruitless sweeps back off 1s to 10s now.
- **A freed or half-overwritten line is rejected, not trusted.**
  `chatmem.js` takes only what parses as a line, printable, under the
  length caps, with a channel tag it knows; the tracker dedups by content
  so the same line in three buffers is one message.

**Not yet done:**

- **The whole chain has never run against a real game.** Every
  measurement above is from the stand-in or from another process. What it
  cannot answer: whether a new chat line ever lands OUTSIDE the regions
  the sweep found (if it does, it waits for the next full sweep -
  `fullRescanMs`, 60s), and what a real poll costs over Dota's hot
  regions rather than a 7 MB toy.
- Replacing the text in place. See the decision above; the overlay is
  first and is built.
- Everything downstream is already built and source-agnostic.

## Testing the reader with no Dota running: a stand-in process

The trick that found all three faults above, and worth reusing. Copy
`node.exe` to `fakedota.exe`, run a script that holds the chat strings -
**verbatim, in both forms** - in buffers and says a new one every few
seconds, then point the scanner at `-ProcessName fakedota`. The scanner,
the parsers, the tracker and the Cyrillic gate all run exactly as they
would; `startMemorySource` takes a `spawnImpl`, so the process name can
be added there without a setting nobody needs. Confirmed this way: the
backlog is primed away, a new all-chat markup line and a new tagged team
line are both shown, and an English line is left alone.

`npm test` also parses every `.ps1` in `src` through PowerShell's own
parser, with a deliberately broken script as a control first. The scanner
is one file nothing else would notice being broken: a syntax error there
is not an error anybody sees, it is a tool that silently never reads a
line.

## Why the old tools died: maintenance, NOT bans (researched, sourced)

| Tool | Technique | Died |
|---|---|---|
| patriksletmo/Dota2Translator | packet sniffing | 2015, no stated reason |
| ur0/DotATranslator | DLL injection | archived Jan 2022 |
| hultarn/dota2-translator | memory reading | 2018, 1 commit, never worked |
| WatcherApps/GameChatTranslator | OCR + Tesseract | alive, Feb 2025 |

`ur0`'s README states it **"requires updates after each DotA 2 patch"**
with no automatic update system. That is patch-broken hardcoded offsets.
**No tool in this space is evidenced to have died from a VAC ban.**

**The capability is not new - the ECOSYSTEM is.** Source 2's runtime schema
system (self-describing classes and field offsets) has been publicly
documented since praydog's 2015 write-up, so resolving by name was possible
while those tools were alive. Nobody maintained public Dota offset dumps
then, so each author carried it alone and quit. CS2 (2023) created the
demand that built the tooling, and it generalises to Dota:

- **ikhsanprasetyo/dota2dumped** - current Dota 2 offset dumps, pushed
  2026-09-17, three days before this was written.
- **boeing666/source2-dumper** - offline schema dumper, **auto-updates per
  patch via GitHub Actions**. Its README names CS2 only; the technique is
  engine-generic.
- a2x/cs2-dumper, praydog/Source2Gen, dougwithseismic/dezlock-dump.

**We may need none of it.** The string scan above uses no offsets at all,
so it cannot be broken by offsets moving.

## VAC: low and undocumented, not zero and established

- Dota 2 is VAC-secured. **No documented case was found of a VAC ban for
  read-only external memory reading of Dota 2.** Absence of reports is not
  proof of safety.
- **Valve has never answered the question in public.**
  ValveSoftware/Dota2-Gameplay#15007 ("Is reading game memory data that the
  client can see allowed?", Jan 2024) got **no employee reply** and was
  closed stale.
- "Read-only is undetectable by VAC" is community reverse-engineering
  (GuidedHacking, r0da), and those same sources warn it is not a guarantee:
  VAC can signature-scan the *external* process, and Valve bans in
  retroactive waves.
- The Steam Subscriber Agreement makes any third-party tool a formal
  violation regardless of technique.
- The dead tools' authors asserted VAC-safety in their READMEs and
  published no Valve correspondence. Treat as assertion, not fact.

## GSI does NOT carry chat - confirmed, stop wondering

Dota sends provider, map, player, hero, abilities, items, buildings, draft,
wearables. No chat, no messages, no event log. No launch option is needed
for GSI (that is a CS:GO-ism). Replays/`.dem` DO contain
`CDOTAUserMsg_ChatMessage` but are written post-match, so there is no live
path. The Steam Game Coordinator exposes Steam chat channels only, never
in-match chat.

**The `DOTA_CHAT` log channel is NOT an unexplored lead.** A web search
will tell you it is, because the measurement exists only in these notes.
`NOTES.md` section 2 measured it: `log_level DOTA_CHAT default` answers
**"Log verbosity levels are locked"**, in a match and in the main menu.
Dead.

## The vision probe - it WORKED, and is still not shippable

Run against real Dota, real Russian chat, `gemini-3.5-flash-lite`.

- **Accuracy: exact.** `не фидите, у них варды на руне` and `иди мид` came
  back character for character, over bright moving terrain. It read
  Cyrillic player names correctly and left English lines alone. One frame
  in seven slipped a single character (`Луизa` with a Latin `a`); dedup
  across frames fixes that for free.
- **A line stays on screen ~7 seconds** - measured, three separate lines,
  seven consecutive 1s frames each. So 2-3s polling is safe.
- **Cost kills it.** ~950-1,100 image tokens per crop; 2s polling over a
  40-minute game is ~1,200 calls, roughly EUR 10-30/month at ten games a
  day - and the free tier's ~1,000 requests/day is exhausted by ONE game.
  Incompatible with the free + own-key model.
- **Local change-detection does NOT rescue it.** The plan was to diff the
  chat region and call only on change, but the game animates continuously
  under the text, so the region changes every frame regardless. Dead idea.
- What might have worked: a cheap local "is there chat on screen" detector
  (e.g. the hero portraits at a fixed x beside every line), with vision
  called only on those frames. Untested, and now unnecessary.

## Screen-capture facts, if this route is ever revisited

- **Dota runs as a window the size of the whole screen** (measured
  5120x1440 here via `GetWindowRect`). Other windows drawn over it are
  captured INSTEAD of the game - a browser sitting over the chat area cost
  two empty bursts and nearly read as "the model cannot see chat".
  `CopyFromScreen` captures Dota fine otherwise; exclusive fullscreen would
  not.
- **When a vision read comes back empty, look at the frame before blaming
  the read.** Two "0 of 60 frames" results were both correct reads of a
  wrongly-cropped region.
- **The chat box position CANNOT be hardcoded** (the user's point: most
  people are not on a 49-inch ultrawide). Here it sat at x~2060, y~975 -
  about 40% across, 68% down - and Dota's UI scale slider moves it again.
  The fix is a one-off calibration per resolution, cached, re-run when it
  stops matching. A tight crop also keeps the user's other windows out of
  whatever gets sent to the model.
- **Raw Tesseract FAILS on this.** `не фидите, у них варды на руне` came
  back as `He фИдите ym вардь уне`, plus hallucinated noise from terrain.
  A brightness threshold (>205) does not separate text from Dota's bright
  stone and grass - both pass it.
- **How GameChatTranslator actually does it**, read from its source and
  worth copying if this is revisited: NOT a threshold, but two NARROW
  greyscale masks, `inRange(235,237)` and `inRange(255,255)`, combined with
  `addWeighted`; inverted for Tesseract; colons deleted by template match
  (`TM_CCOEFF_NORMED` at 0.8) so `Name:` does not confuse the parse;
  `--psm 6`. Its chat box is hand-drawn by the user per game profile -
  there is **no** automatic detection, despite what its README implies. It
  has **no duplicate detection and no upscaling**.
- **Windows.Media.Ocr is built in and free but had only en-GB/en-US here.**
  Russian needs a manual Windows language pack, a bad prerequisite for a
  download-and-run tool. tesseract.js (WASM, npm, no system install) is
  what was tested instead.

## The Gemini key, resolved

The working key is in `config.json` (gitignored). Getting one is fiddlier
than the old notes suggest:

- A **billing-enabled** project answers `402 "prepayment credits are
  depleted"` - the trap already recorded.
- A brand-new project answered `403 "Your project has been denied access."`
  on EVERY model, Gemma included, while `GET /models` returned 200. That is
  a project-level denial, not a model or tier problem. A third key, from a
  different project, worked immediately.
- The free tier rate-limits hard: 4 parallel requests failed about half the
  frames; one at a time was clean.
