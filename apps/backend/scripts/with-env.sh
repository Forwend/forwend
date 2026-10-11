#!/bin/sh
# Runs a command with apps/backend/.env loaded when it exists. CI sets the variables itself.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
# Each process gets only its own secrets: the internet-facing api never holds the executor key.
case "$*" in
  *cmd/signer* | */signer) unset PRIVY_APP_SECRET ;;
  *cmd/api* | */api) unset EXECUTOR_PRIVATE_KEY ;;
  *cmd/worker* | */worker | *cmd/canary*) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET ;;
esac
exec "$@"
