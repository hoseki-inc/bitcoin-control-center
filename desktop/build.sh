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

echo "==> Installing desktop dependencies..."
cd "$SCRIPT_DIR"
npm ci --ignore-scripts
npm run install:electron

echo "==> Installing the Windows libSQL prebuild for cross-platform packaging..."
LIBSQL_VERSION="$(node -p "require('libsql/package.json').optionalDependencies['@libsql/win32-x64-msvc']")"
NATIVE_ARCHIVE="$(npm pack "@libsql/win32-x64-msvc@$LIBSQL_VERSION" --silent)"
mkdir -p node_modules/@libsql/win32-x64-msvc
tar -xzf "$NATIVE_ARCHIVE" -C node_modules/@libsql/win32-x64-msvc --strip-components=1
rm "$NATIVE_ARCHIVE"
test -f node_modules/@libsql/darwin-arm64/index.node
test -f node_modules/@libsql/win32-x64-msvc/index.node
npm run test:runtime

echo "==> Building Sentinel, desktop web app, and Electron shell..."
cd "$REPO_ROOT"
pnpm build:desktop:app

# Package for both Mac and Windows
echo "==> Packaging for macOS..."
cd "$SCRIPT_DIR"
npx electron-builder --mac

echo "==> Packaging for Windows..."
npx electron-builder --win

echo ""
echo "Done! Installers are in desktop/release/"
ls -lh "$SCRIPT_DIR/release/"*.{dmg,exe} 2>/dev/null || true
