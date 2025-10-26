#!/usr/bin/env bash
set -e
export NODE_ENV=${NODE_ENV:-production}
export SMITHERY_HTTP=1
export PORT=${PORT:-8081}
node dist/index.js
