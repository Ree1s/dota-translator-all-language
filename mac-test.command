#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Install Node.js LTS on this Mac, then run this script again.'
  exit 1
fi
if ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then
  echo 'Install Apple Command Line Tools first: xcode-select --install'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run build:mac-helper
npm run doctor:mac
export DT_DEBUG=1
if [ "${1:-}" = "--ocr" ]; then
  npm run start:war3 -- --ocr
elif [ "${1:-}" = "--ocr-preview" ]; then
  npm run start:war3 -- --ocr-preview
elif [ "${1:-}" = "--translate" ]; then
  npm run start:war3
else
  echo 'Capture-only: type in Warcraft chat, commit the IME text, then Esc. Nothing will be sent.'
  npm run start:war3 -- --capture-only
fi
