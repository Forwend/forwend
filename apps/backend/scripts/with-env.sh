#!/bin/sh
# Runs a command with apps/backend/.env loaded when it exists. CI sets the variables itself.
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
# Each process gets only its own secrets: the internet-facing api never holds the executor key. The worker and the api
# hold the email key (the api sends Confirm it's you codes, R-137), and only the worker holds the CoinGecko key;
# the api and the worker hold the 1Click key (D-123); nothing else run through here (tests included) gets them. Only the api and
# webhooks open webhook secrets, and webhooks, which calls any URL an owner gives, holds nothing else (R-148).
case "$*" in
  *cmd/worker* | */worker) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET WEBHOOK_SECRET_KEY ;;
  *cmd/signer* | */signer) unset PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY ONECLICK_API_KEY WEBHOOK_SECRET_KEY ;;
  *cmd/api* | */api) unset EXECUTOR_PRIVATE_KEY COINGECKO_API_KEY ;;
  *cmd/webhooks* | */webhooks) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY ONECLICK_API_KEY RPC_ENDPOINT_SECRETS CANARY_RPC_URLS ;;
  *cmd/ops*) unset EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY ONECLICK_API_KEY WEBHOOK_SECRET_KEY CANARY_RPC_URLS ;;
  *cmd/canary*) unset RPC_ENDPOINT_SECRETS EXECUTOR_PRIVATE_KEY PRIVY_APP_SECRET RESEND_API_KEY COINGECKO_API_KEY ONECLICK_API_KEY WEBHOOK_SECRET_KEY ;;
  *) unset RESEND_API_KEY COINGECKO_API_KEY ONECLICK_API_KEY ;;
esac
exec "$@"
