#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_ID="bitcoin-control-center"
# Umbrel always pulls app images from a registry. A sideload bundle's install
# script serves the image from a temporary registry on the device at this
# loopback address; Docker allows plain HTTP to loopback registries.
SIDELOAD_REGISTRY="127.0.0.1:45400"
ARCHES=(amd64 arm64)

usage() {
  cat <<EOF
Usage: ./umbrel/build.sh [--arch amd64|arm64]

Builds an Umbrel sideload bundle under umbrel/dist/ containing the app package,
container images, and install.sh for the Umbrel owner to run.

Options:
  --arch amd64|arm64   Build one architecture only (default: both)
                       amd64: Umbrel Home and x86 PCs; arm64: Raspberry Pi
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      case "${2:-}" in
        amd64 | arm64) ARCHES=("$2") ;;
        *)
          echo "Unknown architecture: ${2:-}"
          usage
          exit 1
          ;;
      esac
      shift 2
      ;;
    --help | -h)
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

cd "$REPO_ROOT"

# Umbrel uses the same release version as StartOS and desktop. Sideload builds add the
# commit, so every bundle has a distinct Umbrel version and image tag.
RELEASE_VERSION="$(node start9/scripts/version.mjs umbrel)"
SOURCE_COMMIT="$(git rev-parse HEAD)"
DIRTY_SUFFIX=""
if [[ -n "$(git status --porcelain)" ]]; then
  DIRTY_SUFFIX=".dirty"
fi
VERSION="${RELEASE_VERSION}-sideload.$(git rev-parse --short=12 HEAD)${DIRTY_SUFFIX}"
IMAGE="${SIDELOAD_REGISTRY}/${APP_ID}:${VERSION}"
BUNDLE_NAME="${APP_ID}-umbrel-${VERSION}"
# Every bundle extracts to the same folder, so install commands stay short and unchanged.
EXTRACT_NAME="${APP_ID}-umbrel"
DIST_DIR="$SCRIPT_DIR/dist"
STAGE_DIR="$DIST_DIR/$EXTRACT_NAME"

echo "==> Umbrel sideload version: $VERSION"

echo "==> Building api-sentinel..."
corepack pnpm --filter api-sentinel build

echo "==> Building Control Center web app..."
corepack pnpm --filter control-center build
node "$REPO_ROOT/start9/scripts/compress-web-assets.mjs" "$REPO_ROOT/apps/control-center/dist"

rm -rf "$STAGE_DIR" "$DIST_DIR/$BUNDLE_NAME.tar.gz" "$DIST_DIR/$BUNDLE_NAME.tar.gz.sha256"
mkdir -p "$STAGE_DIR/images"

for arch in "${ARCHES[@]}"; do
  echo "==> Building linux/$arch image..."
  docker buildx build \
    --platform "linux/$arch" \
    --file "$SCRIPT_DIR/Dockerfile" \
    --tag "$IMAGE" \
    --output "type=docker,dest=$STAGE_DIR/images/$arch.tar" \
    "$REPO_ROOT"
done

echo "==> Staging app package..."
cp -R "$SCRIPT_DIR/$APP_ID" "$STAGE_DIR/$APP_ID"
sed "s|__VERSION__|$VERSION|g" "$SCRIPT_DIR/$APP_ID/umbrel-app.yml" >"$STAGE_DIR/$APP_ID/umbrel-app.yml"
sed "s|__IMAGE__|$IMAGE|g" "$SCRIPT_DIR/$APP_ID/docker-compose.yml" >"$STAGE_DIR/$APP_ID/docker-compose.yml"
if grep -rq "__IMAGE__\|__VERSION__" "$STAGE_DIR/$APP_ID"; then
  echo "Error: the staged app package has no image or version" >&2
  exit 1
fi

install -m 755 "$SCRIPT_DIR/sideload/install.sh" "$STAGE_DIR/install.sh"
{
  printf 'APP_ID=%q\n' "$APP_ID"
  printf 'VERSION=%q\n' "$VERSION"
  printf 'IMAGE=%q\n' "$IMAGE"
  printf 'REGISTRY=%q\n' "$SIDELOAD_REGISTRY"
  printf 'SOURCE_COMMIT=%q\n' "$SOURCE_COMMIT"
  printf 'ARCHES=%q\n' "${ARCHES[*]}"
} >"$STAGE_DIR/BUILD_INFO"
(cd "$STAGE_DIR" && shasum -a 256 images/*.tar >SHA256SUMS)

echo "==> Packing bundle..."
# Keep macOS metadata files and extended attributes out of the archive.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$DIST_DIR/$BUNDLE_NAME.tar.gz" -C "$DIST_DIR" "$EXTRACT_NAME"
(cd "$DIST_DIR" && shasum -a 256 "$BUNDLE_NAME.tar.gz" >"$BUNDLE_NAME.tar.gz.sha256")
rm -rf "$STAGE_DIR"

echo ""
echo "Done! Send both files to the Umbrel owner:"
ls -lh "$DIST_DIR/$BUNDLE_NAME.tar.gz" "$DIST_DIR/$BUNDLE_NAME.tar.gz.sha256"
echo "On the Umbrel, upload the .tar.gz to Files → Home, then in Settings → Advanced settings → Terminal → umbrelOS run:"
echo "  tar -xzf ~/umbrel/home/$BUNDLE_NAME.tar.gz -C ~"
echo "  ~/$EXTRACT_NAME/install.sh"
