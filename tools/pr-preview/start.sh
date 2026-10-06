#!/usr/bin/env bash
# Runs main and each open redesign PR side by side, each on its own port with the same fictional
# data, and opens a page that compares any PR with main.
#
#   tools/pr-preview/start.sh               fetch, build what changed, start everything, open the page
#   tools/pr-preview/start.sh --reset-data  the same, starting every preview from fresh sample data
#   tools/pr-preview/start.sh --clean       remove the preview worktrees and data, then exit
#
# Press Ctrl-C to stop every preview. See README.md for details.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
WORK="$HERE/.work"
BASE_PORT="${PREVIEW_BASE_PORT:-3500}"
OPEN_PAGE=1

for arg in "$@"; do
  case "$arg" in
    --clean)
      for dir in "$WORK"/worktrees/*; do
        [ -d "$dir" ] && git -C "$REPO" worktree remove --force "$dir"
      done
      rm -rf "$WORK"
      echo "Removed preview worktrees and data."
      exit 0
      ;;
    --reset-data) rm -rf "$WORK/data" ;;
    --no-open) OPEN_PAGE=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

for tool in git node pnpm curl; do
  command -v "$tool" > /dev/null || { echo "Missing $tool. See README.md for requirements." >&2; exit 1; }
done

# Electrum: environment variables win, then this checkout's apps/api-sentinel/.env, then Blockstream's
# public server. The sample data has no on-chain accounts, so no addresses are sent to it.
env_value() {
  local file="$REPO/apps/api-sentinel/.env"
  [ -f "$file" ] && grep -E "^$1=" "$file" | tail -1 | cut -d= -f2- | tr -d '"'"'" || true
}
ELECTRUM_HOST="${ELECTRUM_HOST:-$(env_value ELECTRUM_HOST)}"
if [ -n "$ELECTRUM_HOST" ]; then
  ELECTRUM_PORT="${ELECTRUM_PORT:-$(env_value ELECTRUM_PORT)}"
  ELECTRUM_PROTOCOL="${ELECTRUM_PROTOCOL:-$(env_value ELECTRUM_PROTOCOL)}"
else
  ELECTRUM_HOST=electrum.blockstream.info ELECTRUM_PORT=50002 ELECTRUM_PROTOCOL=ssl
fi
ELECTRUM_PORT="${ELECTRUM_PORT:-50001}"
ELECTRUM_PROTOCOL="${ELECTRUM_PROTOCOL:-tcp}"
echo "Electrum: $ELECTRUM_HOST:$ELECTRUM_PORT ($ELECTRUM_PROTOCOL)"

mkdir -p "$WORK/worktrees" "$WORK/data" "$WORK/logs"
TARGETS="$WORK/targets.tmp"
grep -v -E '^\s*(#|$)' "$HERE/targets.tsv" > "$TARGETS"

# 1. Fetch each ref, and install and build any worktree whose commit changed since the last run.
port="$BASE_PORT"
: > "$WORK/resolved.tsv"
while IFS=$'\t' read -r name ref data; do
  if [ "$ref" = main ]; then
    git -C "$REPO" fetch -q origin main
    dir_name=main
  else
    git -C "$REPO" fetch -q origin "pull/$ref/head"
    dir_name="pr$ref"
  fi
  sha="$(git -C "$REPO" rev-parse FETCH_HEAD)"
  dir="$WORK/worktrees/$dir_name"
  short="$(git -C "$REPO" rev-parse --short "$sha")"

  if [ "$(cat "$dir/.preview-built" 2> /dev/null)" != "$sha" ]; then
    echo "== $dir_name: building $short"
    if [ -d "$dir" ]; then
      git -C "$dir" checkout -q --detach "$sha"
    else
      git -C "$REPO" worktree add -q --detach "$dir" "$sha"
    fi
    (cd "$dir" && pnpm install --frozen-lockfile > "$WORK/logs/install-$dir_name.log" 2>&1) ||
      { echo "   install failed: see .work/logs/install-$dir_name.log" >&2; exit 1; }
    (cd "$dir/apps/control-center" && pnpm exec vite build --outDir dist --mode production.sentinel > "$WORK/logs/build-$dir_name.log" 2>&1) ||
      { echo "   build failed: see .work/logs/build-$dir_name.log" >&2; exit 1; }
    # Sentinel serves the built UI from public/ next to it, on the same port as its API.
    ln -sfn ../control-center/dist "$dir/apps/api-sentinel/public"
    echo "$sha" > "$dir/.preview-built"
  else
    echo "== $dir_name: $short, already built"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$ref" "$data" "$port" "$sha" "$dir" >> "$WORK/resolved.tsv"
  port=$((port + 1))
done < "$TARGETS"

# 2. Start one Sentinel per target. Ctrl-C, or any failure from here on, stops them all.
trap 'trap - EXIT; kill 0' EXIT INT TERM
while IFS=$'\t' read -r name ref data port sha dir; do
  if curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
    echo "Port $port is already in use. Stop whatever is using it, or set PREVIEW_BASE_PORT." >&2
    exit 1
  fi
  fresh=0
  [ -d "$WORK/data/$name" ] || fresh=1
  mkdir -p "$WORK/data/$name"
  echo "$fresh" > "$WORK/data/$name.fresh"
  (
    cd "$dir/apps/api-sentinel" &&
      exec env HOST=localhost PORT="$port" DATA_DIR="$WORK/data/$name" LOG_LEVEL=warn \
        ELECTRUM_HOST="$ELECTRUM_HOST" ELECTRUM_PORT="$ELECTRUM_PORT" ELECTRUM_PROTOCOL="$ELECTRUM_PROTOCOL" \
        BITCOIN_NETWORK=mainnet pnpm exec tsx src/cli.ts --desktop
  ) > "$WORK/logs/sentinel-$name.log" 2>&1 &
done < "$WORK/resolved.tsv"

# 3. Wait for each to answer, then give fresh demo targets the sample portfolio.
while IFS=$'\t' read -r name ref data port sha dir; do
  for _ in $(seq 1 120); do
    curl -sf "http://localhost:$port/health" > /dev/null 2>&1 && break
    sleep 1
  done
  if ! curl -sf "http://localhost:$port/health" > /dev/null 2>&1; then
    echo "$name did not start on :$port. See .work/logs/sentinel-$name.log" >&2
    exit 1
  fi
  if [ "$data" = demo ] && [ "$(cat "$WORK/data/$name.fresh")" = 1 ]; then
    node "$HERE/seed.mjs" "$port" > "$WORK/logs/seed-$name.log" 2>&1 ||
      { echo "$name: seeding failed, see .work/logs/seed-$name.log" >&2; exit 1; }
  fi
  echo "   $name  http://localhost:$port"
done < "$WORK/resolved.tsv"

# 4. Tell the comparison page where everything is, then open it.
{
  echo "window.PREVIEW = { generatedAt: '$(date '+%Y-%m-%d %H:%M')', targets: {"
  while IFS=$'\t' read -r name ref data port sha dir; do
    echo "  '$name': { port: $port, ref: '$ref', sha: '${sha:0:7}', data: '$data' },"
  done < "$WORK/resolved.tsv"
  echo "} }"
} > "$WORK/targets.js"

page="$HERE/index.html"
echo
echo "Comparison page: file://$page"
echo "Press Ctrl-C to stop every preview."
if [ "$OPEN_PAGE" = 1 ]; then
  if command -v open > /dev/null; then open "$page"; elif command -v xdg-open > /dev/null; then xdg-open "$page"; fi
fi
wait
