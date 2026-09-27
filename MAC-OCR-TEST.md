# M1 Max Mac OCR test

This source test package adds Apple Vision OCR to the existing native Mac
outgoing adapter. It has not been compiled or game-tested on macOS yet.
The Windows working checkpoint is `war3-windows-ocr-working-20260927`.

## First run

Install Node.js and Apple Command Line Tools (`xcode-select --install`).
Extract the source ZIP on the Mac, open Terminal in `warcraft-mac-ocr-test`, run:

```sh
bash mac-test.command --ocr-preview
```

The script installs dependencies and compiles/signs the arm64 native helper
locally. In the translator menu-bar icon choose `OCR: select chat area...`.
Grant Screen Recording permission when requested, then quit/relaunch. macOS
may list the helper, Terminal, or packaged translator depending on how launched.
Select again, switch to Warcraft III within five seconds, and drag around
received chat. Use windowed/borderless mode for the first test. Do not include
the chat typing field. Esc cancels selection.

Send an English line using ordinary Enter. The OCR preview should appear above
the selected region. Screenshots stay local; local diagnostic logs contain
recognized text and timings. OCR only captures the foreground Warcraft window.

## Translation and outgoing chat

Save your Gemini key in the Mac translator settings (Windows encrypted keys
are not transferable), quit the preview, then run:

```sh
bash mac-test.command --ocr
```

Incoming English text is translated into Chinese. For outgoing messages,
grant Accessibility and Input Monitoring using the menu's Mac permissions item.
Commit any Chinese IME composition before using **Esc** to translate/send English,
or **Shift+Esc** for savage English. The menu can pause the Esc shortcut.
Esc is intercepted throughout Warcraft while enabled; chat-open detection is
not yet available. Existing outgoing Mac selection/copy settings remain supported.

## Build a local M1 application

After testing:

```sh
npm run dist:war3:mac
```

Outputs DMG and application ZIP in `dist-war3-mac`. Public distribution signing
and notarization require an Apple Developer identity; this test archive is
source code, not a signed/notarized Mac installer. Nothing is published.

## Remaining verification

Native Swift compilation, screen permission prompts, Retina/multiple displays,
selection alignment, actual game OCR speed, subtitles, and Esc sending need
the M1 Max test. Capture uses the macOS 11-compatible Quartz window API, which
is deprecated on newer SDKs; migrate to ScreenCaptureKit if a future SDK removes it.
OCR/translation deduplication and platform argument routing are tested on Windows.
Send compile errors or `war3-ocr.log` (inspect chat text before sharing) for diagnosis.
