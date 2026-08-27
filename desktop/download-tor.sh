#!/usr/bin/env bash
set -euo pipefail

# Downloads Tor Expert Bundle binaries for macOS (aarch64) and Windows (x86_64)
# and places them in the expected directories for electron-builder.
#
# Usage: ./download-tor.sh [VERSION]
#   VERSION defaults to the pinned release below if not specified.

VERSION="${1:-15.0.18}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOR_DIR="${SCRIPT_DIR}/tor"
# Use the Tor Project's permanent archive. dist.torproject.org only retains the
# actively served release and makes pinned desktop builds stop working when a
# newer release is published.
DIST_BASE="https://archive.torproject.org/tor-package-archive/torbrowser/${VERSION}"
TEMP_DIR="$(mktemp -d)"

# These hashes come from the Tor Project's signed-build checksum manifest:
# https://archive.torproject.org/tor-package-archive/torbrowser/15.0.18/sha256sums-signed-build.txt
# A new Tor version must be reviewed and added here before it can enter a build.
case "$VERSION" in
  15.0.18)
    MAC_SHA256="c99cf6f69740a443c7fffaf598ceb0952b3914041507c8afe11bed84a3333eb1"
    WIN_SHA256="6ac067402c7b4a3dc37887ed3754b3914b67fdc220c966190683e9ccf91abf0f"
    ;;
  *)
    echo "No trusted Tor checksums are configured for version ${VERSION}." >&2
    echo "Review the Tor Project's signed checksum manifest and update download-tor.sh." >&2
    exit 1
    ;;
esac

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual

  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    echo "A SHA-256 utility (shasum or sha256sum) is required." >&2
    exit 1
  fi

  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 verification failed for $(basename "$file")." >&2
    echo "Expected: ${expected}" >&2
    echo "Actual:   ${actual}" >&2
    exit 1
  fi
}

echo "Downloading Tor Expert Bundle v${VERSION}..."
echo "Temp directory: ${TEMP_DIR}"
echo ""

# --- macOS (aarch64) ---

MAC_ARCHIVE="tor-expert-bundle-macos-aarch64-${VERSION}.tar.gz"
MAC_URL="${DIST_BASE}/${MAC_ARCHIVE}"
MAC_DEST="${TOR_DIR}/mac"

echo "==> Downloading macOS bundle: ${MAC_ARCHIVE}"
curl -fSL --progress-bar -o "${TEMP_DIR}/${MAC_ARCHIVE}" "${MAC_URL}"
echo "==> Verifying macOS bundle..."
verify_sha256 "${TEMP_DIR}/${MAC_ARCHIVE}" "$MAC_SHA256"

echo "==> Extracting macOS bundle..."
mkdir -p "${TEMP_DIR}/mac"
tar xzf "${TEMP_DIR}/${MAC_ARCHIVE}" -C "${TEMP_DIR}/mac"

echo "==> Installing macOS Tor binary and libraries..."
mkdir -p "${MAC_DEST}"
rm -rf "${MAC_DEST:?}"/*

# The expert bundle extracts to tor/tor (binary) and tor/*.dylib (shared libs)
cp "${TEMP_DIR}/mac/tor/tor" "${MAC_DEST}/tor"
# Copy any dylibs that Tor depends on
if ls "${TEMP_DIR}/mac/tor/"*.dylib 1>/dev/null 2>&1; then
  cp "${TEMP_DIR}/mac/tor/"*.dylib "${MAC_DEST}/"
fi

chmod +x "${MAC_DEST}/tor"
echo "   Installed to ${MAC_DEST}/"

# --- Windows (x86_64) ---

WIN_ARCHIVE="tor-expert-bundle-windows-x86_64-${VERSION}.tar.gz"
WIN_URL="${DIST_BASE}/${WIN_ARCHIVE}"
WIN_DEST="${TOR_DIR}/win"

echo ""
echo "==> Downloading Windows bundle: ${WIN_ARCHIVE}"
curl -fSL --progress-bar -o "${TEMP_DIR}/${WIN_ARCHIVE}" "${WIN_URL}"
echo "==> Verifying Windows bundle..."
verify_sha256 "${TEMP_DIR}/${WIN_ARCHIVE}" "$WIN_SHA256"

echo "==> Extracting Windows bundle..."
mkdir -p "${TEMP_DIR}/win"
tar xzf "${TEMP_DIR}/${WIN_ARCHIVE}" -C "${TEMP_DIR}/win"

echo "==> Installing Windows Tor binary and libraries..."
mkdir -p "${WIN_DEST}"
rm -rf "${WIN_DEST:?}"/*

# The expert bundle extracts to tor/tor.exe (binary) and tor/*.dll (shared libs)
cp "${TEMP_DIR}/win/tor/tor.exe" "${WIN_DEST}/tor.exe"
# Copy any DLLs that Tor depends on
if ls "${TEMP_DIR}/win/tor/"*.dll 1>/dev/null 2>&1; then
  cp "${TEMP_DIR}/win/tor/"*.dll "${WIN_DEST}/"
fi

echo "   Installed to ${WIN_DEST}/"

# --- Summary ---

echo ""
echo "Done! Tor v${VERSION} binaries installed:"
echo ""
echo "  macOS:   ${MAC_DEST}/"
ls -lh "${MAC_DEST}/"
echo ""
echo "  Windows: ${WIN_DEST}/"
ls -lh "${WIN_DEST}/"
