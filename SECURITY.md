# Security

Dota Translator asks you to run an unsigned program from somebody you do
not know. This page is what that program does, how to check it, and how to
tell me if something is wrong.

## What it does on your PC

- **Installs for your Windows user only.** No administrator rights, no
  service, no driver, nothing that starts with Windows. It uninstalls from
  Windows Settings like anything else.
- **Reads Dota 2's memory, read-only**, to get the chat. It opens the game
  with permission to read and to ask, and no more; it never writes to the
  game and injects nothing. One plain-text file: [`src/memscan.ps1`](src/memscan.ps1).
- **Presses keys in Dota only when you press Ctrl+Enter** in the game's chat
  (select, copy, paste, Enter), and only while Dota is the window in front.
  One file: [`src/sendchat.ps1`](src/sendchat.ps1). `"sayHotkey": ""` turns
  it off. While it works it uses your clipboard, and puts back what was there.
- **Talks to three places and no others:** Google's Gemini API (the chat
  lines to translate, under your own key), GitHub (one small offsets file,
  and new versions of the app), and Valve's public image server (a hero
  portrait, only when it cannot be read from your own Dota install).
  There is no server of mine, no account, no analytics in the app.
- **Your Gemini key** is stored on your PC, encrypted by Windows for your
  user (DPAPI). It is sent to Google and to nobody else.

`npm test` fails if the app ever gains a way to write to the game, a second
place that sends keys, or anything that looks like analytics.

## How to check the download

Every release is built by GitHub Actions from the tagged source, in public
- never on my PC. For the file you downloaded:

```
Get-FileHash Dota-Translator-Setup.exe
```

and compare with the SHA-256 on the [release page](https://github.com/sc0rebreaker/dota-translator/releases/latest).
GitHub also signs a statement of which commit the file was built from:

```
gh attestation verify Dota-Translator-Setup.exe --repo sc0rebreaker/dota-translator
```

Or skip the installer: `npm ci`, then `npm start` runs it from source, and
`npm run dist` builds the same installer yourself.

The installer is **not code-signed** (a certificate costs money and this is
free), which is why Windows SmartScreen warns about it. That warning means
"unknown publisher", not "something was found".

## Reporting a problem

Please report a vulnerability privately:
[open a security advisory](https://github.com/sc0rebreaker/dota-translator/security/advisories/new)
(GitHub, "Report a vulnerability"). For anything that is not sensitive, a
normal [issue](https://github.com/sc0rebreaker/dota-translator/issues) is fine.
Only the latest release is supported; the app updates itself.
