#!/bin/sh
# Runs a command with apps/backend/.env loaded when it exists. CI sets the variables itself.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
exec "$@"
