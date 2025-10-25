#!/usr/bin/env bash
set -euo pipefail
export NODE_ENV=${NODE_ENV:-production}
export PORT=${PORT:-8080}
export SMITHERY_HTTP=1
exec node dist/index.js
