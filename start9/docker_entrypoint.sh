#!/bin/bash
set -ea

# Helper: read a yq key with a default. yq returns literal "null" for missing
# keys (exit 0), so we must check for that explicitly.
read_cfg() {
  local val
  val=$(yq "$1" /data/start9/config.yaml 2>/dev/null) || true
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    echo "$2"
  else
    echo "$val"
  fi
}

# StartOS resolves the Electrs bridge address. Sentinel's own Electrum settings
# override it at runtime.
: "${ELECTRUM_HOST:?StartOS must supply the Electrs bridge address}"
: "${ELECTRUM_PORT:?StartOS must supply the Electrs bridge port}"
LOG_LVL=$(read_cfg '.log-level' 'info')

export HOST=0.0.0.0
export PORT=3400
export ELECTRUM_HOST
export ELECTRUM_PORT
export ELECTRUM_PROTOCOL=tcp
export BITCOIN_NETWORK=mainnet
export DATA_DIR=/data
export MEMPOOL_API_URL="${MEMPOOL_API_URL:-$(read_cfg '."mempool-url"' 'https://mempool.space')}"
export NODE_ENV=production
export LOG_LEVEL="$LOG_LVL"
# StartOS supplies its enabled interface addresses. Preserve an explicitly empty
# list (loopback only); use the legacy defaults only for unmanaged container runs.
export SENTINEL_ALLOWED_HOSTS="${SENTINEL_ALLOWED_HOSTS-hoseki-sentinel.local,hoseki-sentinel.embassy,*.local,*.onion,*.embassy}"

exec node --enable-source-maps /app/dist/cli.js
