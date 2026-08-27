#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Downloading Tor binaries (if needed)..."
if [ ! -f "$SCRIPT_DIR/tor/mac/tor" ] || [ ! -f "$SCRIPT_DIR/tor/win/tor.exe" ]; then
  "$SCRIPT_DIR/download-tor.sh"
else
  echo "    Tor binaries already present, skipping download."
fi

echo "==> Building api-sentinel..."
cd "$REPO_ROOT"
pnpm --filter api-sentinel build

echo "==> Building Control Center web app (desktop mode)..."
pnpm --filter control-center build --mode production.desktop

echo "==> Installing desktop dependencies..."
cd "$SCRIPT_DIR"
npm ci --ignore-scripts

echo "==> Validating native SQLite prebuilds..."
test -f node_modules/better-sqlite3/prebuilds/darwin-arm64.node
test -f node_modules/better-sqlite3/prebuilds/win32-x64.node
node -e "const Database = require('better-sqlite3'); const database = new Database(':memory:'); database.close()"

echo "==> Building Electron shell..."
cd "$REPO_ROOT"
npx tsx "$SCRIPT_DIR/src/scripts/build.ts"

# Package for both Mac and Windows
echo "==> Packaging for macOS..."
cd "$SCRIPT_DIR"
npx electron-builder --mac

echo "==> Packaging for Windows..."
npx electron-builder --win

echo ""
echo "Done! Installers are in desktop/release/"
ls -lh "$SCRIPT_DIR/release/"*.{dmg,exe} 2>/dev/null || true
