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
# holds the email and CoinGecko keys; nothing else run through here (tests included) gets them. Only the api and
# webhooks open webhook secrets, and webhooks, which calls any URL an owner gives, holds nothing else (R-148).
case "$*" in
  *cmd/worker* | */worker) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET WEBHOOK_SECRET_KEY ;;
  *cmd/signer* | */signer) unset PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY WEBHOOK_SECRET_KEY ;;
  *cmd/api* | */api) unset EXECUTOR_PRIVATE_KEY RESEND_API_KEY COINGECKO_API_KEY ;;
  *cmd/webhooks* | */webhooks) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY INFURA_API_KEYS RPC_ENDPOINT_SECRETS CANARY_RPC_URLS ;;
  *cmd/canary*) unset RPC_ENDPOINT_SECRETS EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY WEBHOOK_SECRET_KEY ;;
  *) unset RESEND_API_KEY COINGECKO_API_KEY ;;
esac
exec "$@"
