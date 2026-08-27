#!/bin/bash

DURATION=$(</dev/stdin)
if (($DURATION <= 10000)); then
  exit 60
fi
curl -sf http://localhost:3400/health >/dev/null 2>&1 || exit 1
