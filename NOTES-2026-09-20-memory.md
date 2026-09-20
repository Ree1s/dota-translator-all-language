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

**Writing to memory was raised and argued against** (in-place replacement
of the chat text instead of an overlay). Reading is passive; writing is the
thing VAC actually scans for, so it is a different risk class, not a small
step further. Practical blockers too: the translation is usually longer
than the original so it will not fit the allocation, and Panorama
re-renders from its own data. The overlay also keeps the original visible
beside the translation, which matters because machine translation of Dota
slang will sometimes be wrong. If it is ever attempted: separate
experiment, throwaway account, never the main one.

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

**Not yet done:**

- Finding new lines efficiently. An 11s full scan is far too slow to poll.
  Hits cluster in a few allocation ranges, so the next step is to locate
  the chat log container once and read it directly, or narrow scanning to
  those regions.
- Telling a live line from a freed one.
- Everything downstream is already built and source-agnostic.

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
