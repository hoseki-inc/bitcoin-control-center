#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION_ARGS=()
BUILD_ARGS=()

usage() {
  cat <<EOF
Usage: ./start9/build.sh [version options]

Version options:
  --bump major|minor|patch|revision   Update StartOS package version before building
  --version 0.1.1:0                   Set an explicit StartOS package version
  --notes "Release notes"             Release notes for a new version file

StartOS versions use major.minor.patch:revision.
  patch    0.1.0:0 -> 0.1.1:0  app bug fix / maintenance release
  minor    0.1.0:0 -> 0.2.0:0  feature release
  major    0.1.0:0 -> 1.0.0:0  breaking / major release
  revision 0.1.0:0 -> 0.1.0:1  packaging-only rebuild
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)
      VERSION_ARGS=("bump" "$2")
      shift 2
      ;;
    --version)
      VERSION_ARGS=("set" "$2")
      shift 2
      ;;
    --notes)
      BUILD_ARGS+=("--notes" "$2")
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ${#VERSION_ARGS[@]} -gt 0 ]]; then
  echo "==> Updating StartOS package version..."
  node "$SCRIPT_DIR/scripts/version.mjs" "${VERSION_ARGS[@]}" "${BUILD_ARGS[@]}"
fi

echo "==> Validating StartOS version graph..."
node "$SCRIPT_DIR/scripts/version.mjs" check

CURRENT_VERSION="$(node "$SCRIPT_DIR/scripts/version.mjs" get)"
echo "==> StartOS package version: $CURRENT_VERSION"

echo "==> Building api-sentinel..."
cd "$REPO_ROOT"
corepack pnpm --filter api-sentinel build

echo "==> Building Control Center web app..."
corepack pnpm --filter control-center build
node "$SCRIPT_DIR/scripts/compress-web-assets.mjs" "$REPO_ROOT/apps/control-center/dist"

echo "==> Packing s9pk (multi-arch)..."
cd "$SCRIPT_DIR"
make -B universal

echo ""
echo "Done! Sideload the .s9pk file via StartOS UI -> Sideload Service"
ls -lh *.s9pk
