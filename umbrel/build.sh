#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_ID="bitcoin-control-center"
SOURCE_URL="https://github.com/hoseki-inc/bitcoin-control-center"
# Umbrel always pulls app images from a registry. A sideload bundle's install
# script serves the image from a temporary registry on the device at this
# loopback address; Docker allows plain HTTP to loopback registries.
SIDELOAD_REGISTRY="127.0.0.1:45400"
ARCHES=(amd64 arm64)
# Every bundle extracts to the same folder, so install commands stay short and unchanged.
EXTRACT_NAME="${APP_ID}-umbrel"
DIST_DIR="$SCRIPT_DIR/dist"

usage() {
  cat <<EOF
Usage: ./umbrel/build.sh [--arch amd64|arm64]
       ./umbrel/build.sh app
       ./umbrel/build.sh image <amd64|arm64> <sideload|release> <output.tar>
       ./umbrel/build.sh bundle <images directory> <output directory>

Without a command, builds an Umbrel sideload bundle under umbrel/dist/ containing
the app package, container images, and install.sh for the Umbrel owner to run.

Options:
  --arch amd64|arm64   Build one architecture only (default: both)
                       amd64: Umbrel Home and x86 PCs; arm64: Raspberry Pi

The release workflows run the same steps one at a time:
  app      Build Sentinel and the web app that the image copies
  image    Build one architecture's image from the built app: a Docker archive
           tagged for the sideload registry, or an untagged OCI archive to push
           to the release registry
  bundle   Pack a sideload bundle from <images directory>/<arch>.tar
EOF
}

# Umbrel uses the same release version as StartOS and desktop.
release_version() {
  node "$REPO_ROOT/start9/scripts/version.mjs" umbrel
}

# Sideload builds add the commit, so every bundle has a distinct Umbrel version and image tag.
sideload_version() {
  local dirty_suffix=""
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    dirty_suffix=".dirty"
  fi
  echo "$(release_version)-sideload.$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)${dirty_suffix}"
}

sideload_image() {
  echo "${SIDELOAD_REGISTRY}/${APP_ID}:$1"
}

require_arch() {
  case "$1" in
    amd64 | arm64) ;;
    *)
      echo "Unknown architecture: $1" >&2
      usage
      exit 1
      ;;
  esac
}

build_app() {
  cd "$REPO_ROOT"
  echo "==> Building api-sentinel..."
  corepack pnpm --filter api-sentinel build

  echo "==> Building Control Center web app..."
  corepack pnpm --filter control-center build
  node "$REPO_ROOT/start9/scripts/compress-web-assets.mjs" "$REPO_ROOT/apps/control-center/dist"
}

build_image() {
  local arch="$1" kind="$2" dest="$3" version
  local tag_args=() output
  require_arch "$arch"
  case "$kind" in
    sideload)
      version="$(sideload_version)"
      tag_args=(--tag "$(sideload_image "$version")")
      output="type=docker,dest=$dest"
      ;;
    release)
      # The publish job pushes the image by digest and tags only the multi-arch index.
      version="$(release_version)"
      output="type=oci,dest=$dest"
      ;;
    *)
      echo "Unknown image kind: $kind" >&2
      usage
      exit 1
      ;;
  esac

  echo "==> Building linux/$arch image ($version)..."
  mkdir -p "$(dirname "$dest")"
  # Buildx's own provenance and SBOM would wrap each image in an index; releases attest the
  # published multi-arch index instead.
  docker buildx build \
    --platform "linux/$arch" \
    --file "$SCRIPT_DIR/Dockerfile" \
    --provenance=false \
    --sbom=false \
    --label "org.opencontainers.image.source=$SOURCE_URL" \
    --label "org.opencontainers.image.revision=$(git -C "$REPO_ROOT" rev-parse HEAD)" \
    --label "org.opencontainers.image.version=$version" \
    ${tag_args[@]+"${tag_args[@]}"} \
    --output "$output" \
    "$REPO_ROOT"
}

pack_bundle() {
  local images_dir="$1" out_dir="$2" version image bundle_name stage_dir arch
  local arches=()
  version="$(sideload_version)"
  image="$(sideload_image "$version")"
  bundle_name="${APP_ID}-umbrel-${version}"
  stage_dir="$out_dir/$EXTRACT_NAME"

  for arch in amd64 arm64; do
    if [[ -f "$images_dir/$arch.tar" ]]; then
      # An image built from another commit would install under the wrong version.
      if ! tar -xOf "$images_dir/$arch.tar" manifest.json | grep -Fq "\"$image\""; then
        echo "Error: $images_dir/$arch.tar is not tagged $image" >&2
        exit 1
      fi
      arches+=("$arch")
    fi
  done
  if [[ ${#arches[@]} -eq 0 ]]; then
    echo "Error: $images_dir has no amd64.tar or arm64.tar image" >&2
    exit 1
  fi

  rm -rf "$stage_dir" "$out_dir/$bundle_name.tar.gz" "$out_dir/$bundle_name.tar.gz.sha256"
  mkdir -p "$stage_dir/images"
  for arch in "${arches[@]}"; do
    cp "$images_dir/$arch.tar" "$stage_dir/images/$arch.tar"
  done

  echo "==> Staging app package..."
  cp -R "$SCRIPT_DIR/$APP_ID" "$stage_dir/$APP_ID"
  sed "s|__VERSION__|$version|g" "$SCRIPT_DIR/$APP_ID/umbrel-app.yml" >"$stage_dir/$APP_ID/umbrel-app.yml"
  sed "s|__IMAGE__|$image|g" "$SCRIPT_DIR/$APP_ID/docker-compose.yml" >"$stage_dir/$APP_ID/docker-compose.yml"
  if grep -rq "__IMAGE__\|__VERSION__" "$stage_dir/$APP_ID"; then
    echo "Error: the staged app package has no image or version" >&2
    exit 1
  fi

  install -m 755 "$SCRIPT_DIR/sideload/install.sh" "$stage_dir/install.sh"
  {
    printf 'APP_ID=%q\n' "$APP_ID"
    printf 'VERSION=%q\n' "$version"
    printf 'IMAGE=%q\n' "$image"
    printf 'REGISTRY=%q\n' "$SIDELOAD_REGISTRY"
    printf 'SOURCE_COMMIT=%q\n' "$(git -C "$REPO_ROOT" rev-parse HEAD)"
    printf 'ARCHES=%q\n' "${arches[*]}"
  } >"$stage_dir/BUILD_INFO"
  (cd "$stage_dir" && shasum -a 256 images/*.tar >SHA256SUMS)

  echo "==> Packing bundle..."
  # Keep macOS metadata files and extended attributes out of the archive.
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$out_dir/$bundle_name.tar.gz" -C "$out_dir" "$EXTRACT_NAME"
  (cd "$out_dir" && shasum -a 256 "$bundle_name.tar.gz" >"$bundle_name.tar.gz.sha256")
  rm -rf "$stage_dir"
}

case "${1:-}" in
  app)
    [[ $# -eq 1 ]] || {
      usage
      exit 1
    }
    build_app
    exit 0
    ;;
  image)
    [[ $# -eq 4 ]] || {
      usage
      exit 1
    }
    build_image "$2" "$3" "$4"
    exit 0
    ;;
  bundle)
    [[ $# -eq 3 ]] || {
      usage
      exit 1
    }
    pack_bundle "$2" "$3"
    exit 0
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      require_arch "${2:-}"
      ARCHES=("$2")
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

node "$REPO_ROOT/start9/scripts/version.mjs" check
echo "==> Umbrel sideload version: $(sideload_version)"

build_app

IMAGES_DIR="$DIST_DIR/images"
rm -rf "$IMAGES_DIR"
for arch in "${ARCHES[@]}"; do
  build_image "$arch" sideload "$IMAGES_DIR/$arch.tar"
done

pack_bundle "$IMAGES_DIR" "$DIST_DIR"
rm -rf "$IMAGES_DIR"

BUNDLE_NAME="${APP_ID}-umbrel-$(sideload_version)"
echo ""
echo "Done! Send both files to the Umbrel owner:"
ls -lh "$DIST_DIR/$BUNDLE_NAME.tar.gz" "$DIST_DIR/$BUNDLE_NAME.tar.gz.sha256"
echo "Install steps: umbrel/README.md"
