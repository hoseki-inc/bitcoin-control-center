#!/bin/bash
set -ea

case "$1" in
  create)
    # Back up SQLite data only. Exchange API credentials are encrypted with a
    # local key stored outside sentinel.db, so restored exchanges must reconnect.
    tar -czf /data/backup.tar.gz -C /data sentinel.db
    ;;
  restore)
    tar -xzf /data/backup.tar.gz -C /data
    mkdir -p /data/secrets
    rm -f /data/secrets/exchange-credentials.key
    touch /data/secrets/exchange-credentials.restored
    ;;
esac
