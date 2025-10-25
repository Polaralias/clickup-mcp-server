#!/usr/bin/env bash
set -e
export NODE_ENV=${NODE_ENV:-production}
node dist/index.js
