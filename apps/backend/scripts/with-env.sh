#!/bin/sh
# Runs a command with apps/backend/.env loaded when it exists. CI sets the variables itself.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
# Each process gets only its own secrets: the internet-facing api never holds the executor key, and only the worker
# holds the email key; nothing else run through here (tests included) gets it.
case "$*" in
  *cmd/worker* | */worker) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET ;;
  *cmd/signer* | */signer) unset PRIVY_APP_SECRET RESEND_API_KEY ;;
  *cmd/api* | */api) unset EXECUTOR_PRIVATE_KEY RESEND_API_KEY ;;
  *cmd/canary*) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY ;;
  *) unset RESEND_API_KEY ;;
esac
exec "$@"
