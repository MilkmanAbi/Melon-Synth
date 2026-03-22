#!/usr/bin/env bash
# Melon Synth dev launcher
set -e
cd "$(dirname "$0")/.."

echo "→ Compiling Electron main + preload..."
./node_modules/.bin/tsc -p tsconfig.electron.json
# Ensure electron output is treated as CommonJS (needed when root has "type":"module")
echo '{"type":"commonjs"}' > electron/package.json

echo "→ Starting Vite renderer..."
./node_modules/.bin/vite &
VITE_PID=$!
trap "kill $VITE_PID 2>/dev/null; exit" EXIT INT TERM

echo -n "→ Waiting for Vite at :5173"
for i in $(seq 1 40); do
  if curl -s http://localhost:5173 > /dev/null 2>&1; then
    echo " ready."
    break
  fi
  sleep 0.5
  printf "."
done
echo

echo "→ Launching Electron..."
# --no-sandbox fixes the SUID sandbox permission issue on Linux
# Safe for local development; remove for production builds
NODE_ENV=development ./node_modules/.bin/electron . --no-sandbox
