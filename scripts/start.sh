#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV="${NODE_ENV:-production}"
export SMITHERY_HTTP=1
export PORT="${PORT:-8081}"

exec node dist/index.js
