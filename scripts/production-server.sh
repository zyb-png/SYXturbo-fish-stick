#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$APP_DIR"

export NODE_ENV=production
export PORT="${PORT:-5001}"
export DEPLOY_RUN_PORT="$PORT"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec ./node_modules/.bin/next start --port "$PORT" --hostname 0.0.0.0
