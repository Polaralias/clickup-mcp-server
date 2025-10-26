#!/usr/bin/env bash
set -euo pipefail
export SMITHERY_HTTP=1
export PORT=${PORT:-8081}
export NODE_ENV=${NODE_ENV:-production}
exec node dist/index.js
