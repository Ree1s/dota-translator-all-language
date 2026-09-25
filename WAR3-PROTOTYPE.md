# Live capture verified ? 2026-09-25

In a running Battle.net Warcraft III process, three user-triggered F7 captures returned exactly U+5148 U+7EC3 U+7EA7 (???). End ? Shift+Home ? Ctrl+C therefore works for this tested chat input, unlike the original Ctrl+A selection. No OCR is needed for this observed case. Translation, replacement/paste and actual sent output remain the next live check; capture-only did not send anything.

# Separate local development branches

- `dev/dota2`: `C:\Users\User\dota-translator-dota2`, start with `npm.cmd start`. Original Dota code plus the additive safety restriction required by its existing test. All 142 baseline tests pass. Existing config and Dota cache copied locally without committing secrets.
- `experiment/war3-translator`: `C:\Users\User\dota-translator-all-language`, continue the experiment here. Run `npm.cmd run start:war3 -- --capture-only` for the current controlled test.

Both branches start from the original local commit and preserve the pre-existing dependency lockfile change. No remote fetch, reset or push was used. The worktrees share the installed node_modules through a local junction; source and configuration files are separate. Quit the currently running translator before switching applications because the Electron single-instance lock is shared.

# Current direction: in-game chat, no focus switch

The independent composer is now optional (`--composer`), not the normal War3 workflow. Normal F6?F9 call the in-game translator again. War3 selection uses End then Shift+Home (with extended-key flags), followed by Ctrl+C and Ctrl+V. Dota retains Ctrl+A. This selection alternative is experimental until live capture has been observed; the earlier blank Ctrl+A/C result did not establish that copying itself is unsupported.

`npm.cmd run start:war3 -- --capture-only` makes F6?F9 select and copy only, print `war3 capture-only` with captured text, restore the text clipboard in finally, and beep. It never translates, pastes or sends. Type a known line in a bot-game chat, press F7, and inspect the capture log. Default copy/paste uses Ctrl+C/V; `$env:DT_WAR3_CLIPBOARD_KEYS='insert'` selects Ctrl+Insert / Shift+Insert for another controlled test.

Live validation required: exact whole-line capture, replacement without duplicate source, paste, Enter and exclusive fullscreen. No OCR has been added yet. If alternate selection/copy fails, targeted OCR is the next candidate under the user's authorization to use another method without leaving game chat.

---

# Current workflow: independent input (supersedes the original capture prototype below)

Live feedback established that manual Ctrl+A/C produced a blank clipboard in Warcraft III; the in-game capture path is not usable on this setup. Normal War3 mode now opens an independent Chinese-language composer instead of simulating copy/send.

Run `npm.cmd run start:war3`. The composer opens at startup; F6 opens the default target, F7 English, F8 Russian, F9 Filipino, optionally Shift for savage. A tray menu entry also opens it. Type in this window, click ?? (or Ctrl+Enter), review the result, then click ???????. Alt+Tab back to Warcraft, open chat, Ctrl+V, Enter. Pasting into Warcraft is still unverified. The app does not send any game keystrokes in this workflow. Exclusive fullscreen may minimize when this window opens.

Translation does not alter the clipboard; Copy does. After pasting, reopen the composer and use ???????? to restore the previous text, provided no other application has since changed it. Restoration is explicit because the app cannot know when a manual paste occurred. Text-only clipboard preservation remains a limitation. Input remains limited to 200 characters. Errors appear directly in the composer. Gemini, game prompts and said-war3.json are reused; no incoming learning occurs.

Verified with a mocked provider through the real Electron preload/IPC/renderer: result display and enabled copy button. Real provider translation and Warcraft paste still need user verification. Unit coverage includes concurrency, failure, validation and clipboard preservation.

---

# Warcraft III outgoing prototype

Local branch: experiment/war3-translator. Nothing pushed or published.

## Run and test

Close any running Dota Translator first (the app uses a single-instance lock).
From C:\Users\User\dota-translator-all-language, in PowerShell:

```powershell
$env:DT_DEBUG='1'
npm.cmd run start:war3
```

Save your own Gemini key in the existing settings UI if needed. Secure key storage is reused. War3 never uses the Dota hosted service. `npm start` remains Dota mode.

Launch Battle.net Warcraft III, enter a bot/custom game, then open its chat input. The process discovery printed at startup should name the running game; restart the translator after launching the game to see it. No process was running during development, so `Warcraft III` is an UNVERIFIED fallback, not a detected name. Run `npm.cmd run doctor:war3 -- --once` to see actual processes. If necessary set `$env:DT_WAR3_PROCESS='exact ProcessName'` before launching (no .exe), or set `war3ProcessName` in config.json.

First validate keyboard compatibility without a Gemini call:

```powershell
npm.cmd run start:war3 -- --chat-test
```

This mode copies and sends the text unchanged when a translation chord is pressed. Put `clipboard sentinel` on your clipboard, open game chat, type `测试123`, then press and release F6. Confirm the diagnostic captured exactly that text, the game sent it exactly once, and pasting into Notepad afterward gives `clipboard sentinel`. This jointly checks Ctrl+A/C/V/Enter. A `copied` helper response only confirms key simulation; the captured text and visible game result establish compatibility. Exit this mode before translation testing.

Restart with `npm.cmd run start:war3`. Open chat and type a fresh Chinese line before EACH test (for example `先练级，然后开分矿`). Test these eight chords:

| Chord | Target | Style |
|---|---|---|
| F6 | configured reply language; auto falls back to display language | faithful |
| Shift+F6 | same default | savage |
| F7 | English | faithful |
| F8 | Russian | faithful |
| F9 | Filipino/Tagalog | faithful |
| Shift+F7 | English | savage |
| Shift+F8 | Russian | savage |
| Shift+F9 | Filipino/Tagalog | savage |

For numbered chords hold Ctrl (and Shift), hold Enter, tap the digit, then release all keys. Base chords trigger on release; numbered chords fire once. Digits 0 and 4–9 do not select a language or send. Verify one sent message per chord and clipboard restoration. Repeat one input in both styles to check distinct cached outputs. Focus another application during translation: the helper must refuse send.

If anything fails, paste the startup `war3 process` line, `war3 focus`, `war3 hotkey`, `copy`, `captured`, `Gemini request start/end`, `send`, and final `say` lines for ONE attempt, plus whether the chat stayed open and what appeared. Do not paste config.json or your key. Debug output includes chat text. Request start/end also brackets cache lookups and is not proof of a network request.

## Incoming discovery

```powershell
npm.cmd run doctor:war3
```

It discovers bounded roots through Windows known folders, Blizzard registry entries and running process paths, snapshots at most 5,000 entries up to depth five, then waits. Send a unique message, return to the terminal and press Enter. It reports changed/deleted files and up to 64 KiB of newly appended valid UTF-8 text; binary replay contents are not printed. Repeat with another unique message. No source files are modified. Appended logs may contain private information; inspect before sharing.

Observed locally: 254 candidate files under Documents\Warcraft III, an older registry-discovered 1.27a install, and LocalAppData\Battle.net\Logs. Candidates include Logs\War3Log.txt, selection.log, crash logs and replay files. The current War3Log tail showed engine/model loading failures and GameMain Ended. There was no running game, no controlled chat event and no demonstrated repeatable player-chat source. This is inconclusive, not proof that logs cannot work. No war3source adapter, OCR, memory reader, injection or packet capture was added. The next step is the controlled repeated diagnostic; region OCR may be considered separately if logs fail.

## Implementation and limitations

Reuses Electron settings/key storage, outgoing Gemini translator, language detector, style-aware cache, foreground GetAsyncKeyState watcher and keyboard helper. The War3 startup path bypasses Dota GSI, offsets fetching, learned incoming state and hosted heartbeat. Cache: said-war3.json. Settings/key remain shared. Prompts retain the local wording, with game context selected separately and one additive protected-class safety restriction to satisfy the existing failing test. Savage results do not teach literal translations.

Clipboard preservation inherits the existing text-only behavior (images and rich formats are not preserved). War3 additionally restores text on send refusal. Input must fit the inherited 200-character source limit. PowerShell polls keys; it cannot prevent Warcraft itself from reacting to F6 or a digit. This is why live testing is required. Electron overlay is not needed for outgoing hotkeys and may not appear above true exclusive fullscreen. Some shared UI still says Dota.

No live Ctrl+A/C/V compatibility or any of the eight game-side hotkeys has been verified yet. No exact Warcraft process name was detected during development.

Validation: baseline npm test failed at the existing savage prompt safety assertion. After changes: npm test exits 0, 142 existing tests and 5 War3 groups pass, including PowerShell parse checks. Full output: war3-test-result.txt. No existing tests removed or weakened. The pre-existing package-lock.json changes were preserved.
