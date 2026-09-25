# Mac M1 Max test build — English only

This is a source test package, not a verified DMG. Implemented on Windows; the native Swift helper has NOT been compiled or executed on macOS yet. JS integration/regression tests pass. Your M1 Max is the first native build and game test environment.

## First run on your Mac

1. Copy this project ZIP to the Mac and extract it (keep the folder intact).
2. Install Node.js LTS if not already installed, and Apple Command Line Tools using `xcode-select --install` in Terminal.
3. In Terminal, type `cd `, drag the extracted folder into Terminal, and press Return.
4. Run `bash mac-test.command`. It installs npm dependencies if missing, compiles an arm64 helper, reports running Warcraft metadata/permissions, and starts **capture-only** mode.
5. Use the translator's menu-bar icon → **Enable Mac permissions...**. In System Settings → Privacy & Security, allow **Accessibility** and **Input Monitoring** for the translator/helper/Terminal shown by macOS. Restart the translator after granting access. A development build may be attributed to Terminal or Electron; a signed packaged build may be attributed differently.
6. Launch Battle.net Warcraft III, enter a bot/custom game and open its own chat input. Type `先练级`, and finish selecting the Chinese IME candidate first. Press and release **Esc**.
7. Check the terminal: `war3 capture-only` must show `captured:true` and exactly `先练级`. No Gemini call, paste or send occurs in this mode. Check that the chat field stayed open and the previous text clipboard was restored. Repeat with **Shift+Esc**: hold Shift, press/release Esc, then release Shift.

Esc and Shift+Esc are intercepted only when the matched Warcraft process is foreground. Other apps retain Esc. While enabled, Esc is also intercepted in Warcraft menus: this prototype does not know whether chat is open. Disable **Mac Esc translation enabled** in the translator menu to restore normal Esc, or quit the translator. Do not use a competitive match for first testing. No screen recording permission is needed.

## If capture fails

Quit the translator before each retry. Default keys are End → Shift+Home → Command+C; send uses the same selection followed by Command+V and Enter. These are candidates, not verified Warcraft Mac shortcuts.

Try the game's Windows-style modifier:

```sh
DT_MAC_COPY_MODIFIER=control bash mac-test.command
```

Or native Mac line selection:

```sh
DT_MAC_SELECTION=command-arrows bash mac-test.command
```

Both overrides can be combined. The second selects with Command+Right, then Shift+Command+Left. Do not enable translation/send until the diagnostic repeatedly captures the complete original line. There is no automatic fallback that might send the wrong text.

If process discovery is empty while the game is running, paste only the `doctor:mac` and startup output back. The helper matches the exact executable basename `Warcraft III`; a verified alternative can be supplied as `DT_WAR3_PROCESS`, or a verified bundle ID as `DT_WAR3_BUNDLE_ID`. Names have not been verified on your Mac yet.

## After capture is verified

Quit, then run `bash mac-test.command --translate`. Fill your own Gemini key in settings (Windows DPAPI-encrypted keys cannot be copied to macOS). Type in game and use:

- Esc: faithful English.
- Shift+Esc: savage English.

Wait without pressing Enter or typing more. Confirm one translated message, no leftover source and clipboard restoration. Test Chinese IME, exclusive fullscreen, focus changes during translation, selection from the middle of a line and repeat presses. Translation cache and prompts reuse the War3 components; incoming translation stays off.

## Build DMG + ZIP on the M1 Mac

```sh
npm run dist:war3:mac
```

This compiles the arm64 helper and produces DMG/ZIP under `dist-war3-mac/`. The helper is unpacked from ASAR and listed for signing. Configuration never publishes. Local helper signing is ad hoc; trusted Developer ID signing/notarization needs your Apple credentials and macOS tooling. No credentials are included. Do not distribute as a working release until the native compile, permissions, installed app and game tests succeed.

Installed data: `~/Library/Application Support/Warcraft Chat Translator/`. The `--war3` default is embedded in packaged metadata. Windows and Dota branches retain their bindings; Mac supports English only in this first version.

Implementation: NSWorkspace exact foreground executable/bundle check; a system CGEvent tap handles Esc press/release, shift ordering, repeats and focus changes; CGEvent posts guarded selection/copy/paste/Enter. Every new key down checks the same foreground PID and accessibility authorization. Already-pressed keys are always released. No game memory access, DLL injection or game-side hooks. No other typed characters are logged by the event tap. The input text is read from the clipboard only after an explicit translation/capture chord.

References: Apple CGEvent / NSWorkspace / Accessibility APIs; electron-builder v26 macOS configuration. Accessibility and input interception may be affected by Secure Input or game handling; live tests decide compatibility.
