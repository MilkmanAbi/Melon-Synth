#!/usr/bin/env bash
# Watches electron-src/ and recompiles on change (run in a second terminal)
cd "$(dirname "$0")/.."
./node_modules/.bin/tsc -p tsconfig.electron.json --watch
