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

# Read config written by StartOS config scripts
ELECTRUM_HOST=$(read_cfg '.electrum.host' 'electrs.embassy')
ELECTRUM_PORT=$(read_cfg '.electrum.port' '50001')
ELECTRUM_PROTOCOL=$(read_cfg '.electrum.protocol' 'tcp')
LOG_LVL=$(read_cfg '.log-level' 'info')

export HOST=0.0.0.0
export PORT=3400
export ELECTRUM_HOST
export ELECTRUM_PORT
export ELECTRUM_PROTOCOL
export BITCOIN_NETWORK=mainnet
export DATA_DIR=/data
export MEMPOOL_API_URL="https://mempool.space"
export NODE_ENV=production
export LOG_LEVEL="$LOG_LVL"
export SENTINEL_ALLOWED_HOSTS="${SENTINEL_ALLOWED_HOSTS:-hoseki-sentinel.local,hoseki-sentinel.embassy,*.local,*.onion,*.embassy}"

exec node --enable-source-maps /app/dist/cli.js
