# Windows Warcraft III OCR prototype

Start with `npm run start:war3:ocr` (English incoming chat to Chinese), or
`npm run test:war3:ocr` (local recognition preview, no translation requests).
Outgoing F7/F8 shortcuts remain available. OCR is opt-in; the Dota branch is unchanged.

1. Use windowed/borderless Warcraft III for the external subtitle overlay.
2. Show some chat, then right-click the translator tray icon and choose
   `OCR: select chat area (switch to game in 5s)`.
3. Return to Warcraft within five seconds. Drag around the received chat lines.
   Exclude the typing field, HUD labels and the bottom-right subtitle area.
   Escape cancels. The region is saved relative to the game client area.
4. Send `hello, lets level up first` with ordinary Enter. Check the subtitle
   and `war3-ocr.log` in the translator data directory. No second player is
   needed for the first recognition test.
5. The tray's stop action stops incoming OCR. Quit stops its helper as well.

Only the foreground `Warcraft III` window is captured. Screenshots are processed
locally, not uploaded or saved. Recognized player-prefixed chat is logged locally
and sent to the configured Gemini key in translation mode. Missing keys/errors
are reported; there is no Dota hosted-service fallback.

The machine currently has English, German and Simplified Chinese OCR languages.
Default is English. `DT_WAR3_OCR_LANGUAGE` can choose an installed language tag.
Russian requires a Windows OCR language component and separate verification.

This prototype polls at about 500 ms, requires two matching OCR frames, and
suppresses recently seen identical messages for 60 seconds after disappearance.
Wrapped lines, changing OCR errors, repeated identical messages, map notices
containing colons, exclusive fullscreen capture, HDR and multiple displays need
live evaluation. It does not claim to perfectly distinguish senders or new events.
The caption is protected from capture to avoid translation feedback.

`ocrMs` measures screenshot/recognition. `translationMs` measures the translation
call including cache hits. `pipelineMs` starts at stable recognition, not the
original game send time; add polling/stabilization time when assessing latency.

Validation: `node test-war3ocr.js`, `npm test`; native OCR tested with a generated
English chat fixture. Live Warcraft OCR and fullscreen subtitles remain unverified.
