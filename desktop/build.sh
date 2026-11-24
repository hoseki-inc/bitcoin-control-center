#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="${1:-}"
case "$TARGET" in
  '')
    case "$(uname -s)" in
      Darwin) TARGET=--mac ;;
      MINGW*|MSYS*|CYGWIN*) TARGET=--win ;;
      *) echo 'Specify --win to cross-build Windows, or use a native Mac/Windows runner.' >&2; exit 1 ;;
    esac
    ;;
  --mac|--mac-dir|--win|--all) ;;
  *) echo 'Usage: ./desktop/build.sh [--mac|--mac-dir|--win|--all]' >&2; exit 1 ;;
esac

cd "$REPO_ROOT"
node start9/scripts/version.mjs check
VERSION="$(node start9/scripts/version.mjs get)"
TAG="$(node start9/scripts/version.mjs tag)"
APP_VERSION="${VERSION%:*}"
SOURCE_SHA="$(git rev-parse HEAD)"
SOURCE_DIRTY=false
if [[ -n "$(git status --porcelain)" ]]; then SOURCE_DIRTY=true; fi

if [[ "$TARGET" == --mac || "$TARGET" == --mac-dir || "$TARGET" == --all ]]; then
  if [[ "$(uname -s)" != Darwin ]]; then
    echo 'Mac packaging requires macOS. The supported Mac target is Apple Silicon.' >&2
    exit 1
  fi
fi

NEED_MAC_TOR=false
NEED_WIN_TOR=false
if [[ "$TARGET" == --mac || "$TARGET" == --mac-dir || "$TARGET" == --all ]]; then NEED_MAC_TOR=true; fi
if [[ "$TARGET" == --win || "$TARGET" == --all ]]; then NEED_WIN_TOR=true; fi

if { [[ "$NEED_MAC_TOR" == true ]] && [[ ! -f "$SCRIPT_DIR/tor/mac/tor" ]]; } || \
   { [[ "$NEED_WIN_TOR" == true ]] && [[ ! -f "$SCRIPT_DIR/tor/win/tor.exe" ]]; }; then
  "$SCRIPT_DIR/download-tor.sh"
fi

if [[ "$TARGET" == --mac-dir ]]; then
  LOCK_HASH="$(shasum -a 256 "$SCRIPT_DIR/package-lock.json" | awk '{print $1}')"
  LOCK_STAMP="$SCRIPT_DIR/node_modules/.bcc-lock-sha256"
  if [[ -d "$SCRIPT_DIR/node_modules" && -f "$LOCK_STAMP" && "$(cat "$LOCK_STAMP")" == "$LOCK_HASH" && -f "$SCRIPT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" && -f "$SCRIPT_DIR/node_modules/@libsql/darwin-arm64/index.node" ]]; then
    echo "==> Reusing desktop/node_modules (matches package-lock.json)"
  else
    npm ci --prefix "$SCRIPT_DIR" --ignore-scripts
    npm run install:electron --prefix "$SCRIPT_DIR"
    printf '%s' "$LOCK_HASH" > "$LOCK_STAMP"
  fi
else
  npm ci --prefix "$SCRIPT_DIR" --ignore-scripts
  npm run install:electron --prefix "$SCRIPT_DIR"
fi
corepack pnpm build:desktop:app

cd "$SCRIPT_DIR"
COMMON=(
  --publish never
  "-c.extraMetadata.version=$APP_VERSION"
  "-c.extraMetadata.bccReleaseVersion=$VERSION"
  "-c.extraMetadata.bccSourceCommit=$SOURCE_SHA"
  "-c.extraMetadata.bccSourceDirty=$SOURCE_DIRTY"
  "-c.buildVersion=$APP_VERSION"
)

if [[ "$TARGET" == --win || "$TARGET" == --all ]]; then
  if [[ ! -f node_modules/@libsql/win32-x64-msvc/index.node ]]; then
    echo "==> Installing the Windows libSQL prebuild for cross-platform packaging..."
    LIBSQL_VERSION="$(node -p "require('./node_modules/libsql/package.json').optionalDependencies['@libsql/win32-x64-msvc']")"
    NATIVE_ARCHIVE="$(npm pack "@libsql/win32-x64-msvc@$LIBSQL_VERSION" --silent)"
    mkdir -p node_modules/@libsql/win32-x64-msvc
    tar -xzf "$NATIVE_ARCHIVE" -C node_modules/@libsql/win32-x64-msvc --strip-components=1
    rm "$NATIVE_ARCHIVE"
  fi
  test -f node_modules/@libsql/win32-x64-msvc/index.node
fi
if [[ "$TARGET" == --mac || "$TARGET" == --mac-dir || "$TARGET" == --all ]]; then
  test -f node_modules/@libsql/darwin-arm64/index.node
fi
if [[ "$TARGET" != --mac-dir ]]; then
  npm run test:runtime
  # The staging step copies the installer by name, so never leave one from an earlier build to pick up.
  rm -f release/Bitcoin-Control-Center-*.dmg release/Bitcoin-Control-Center-*.exe
fi

if [[ "$TARGET" == --mac-dir ]]; then
  CSC_FOR_PULL_REQUEST=true npx --no-install electron-builder --mac --arm64 --dir "${COMMON[@]}" -c.mac.identity=- -c.mac.hardenedRuntime=false
  codesign --verify --deep --strict 'release/mac-arm64/Bitcoin Control Center.app'
  echo "Packaged macOS app is in desktop/release/mac-arm64/Bitcoin Control Center.app"
  exit 0
fi

if [[ "$TARGET" == --mac || "$TARGET" == --all ]]; then
  # Ad-hoc review signatures cannot satisfy hardened-runtime Team ID validation
  # for Electron's framework, so the hardened runtime is added when releases are
  # re-signed with the Developer ID (.github/workflows/mac-sign.yml).
  # PR builds normally skip signing entirely. This command uses only an ad-hoc
  # identity (no certificate or secret), which is still required on Apple Silicon.
  CSC_FOR_PULL_REQUEST=true npx --no-install electron-builder --mac --arm64 "${COMMON[@]}" -c.mac.identity=- -c.mac.hardenedRuntime=false \
    "-c.artifactName=Bitcoin-Control-Center-${TAG}-mac-arm64.\${ext}"
  codesign --verify --deep --strict 'release/mac-arm64/Bitcoin Control Center.app'
  node scripts/stage-artifact.mjs mac
fi
if [[ "$TARGET" == --win || "$TARGET" == --all ]]; then
  npx --no-install electron-builder --win --x64 "${COMMON[@]}" \
    "-c.artifactName=Bitcoin-Control-Center-${TAG}-win-x64.\${ext}"
  node scripts/stage-artifact.mjs win
fi

echo "Installers and release metadata are in desktop/release/artifacts/"
