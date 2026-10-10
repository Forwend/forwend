#!/bin/sh
# Root `pnpm dev` runs this beside the web app. Ctrl+C stops all Go processes.
set -e
cd "$(dirname "$0")/.."
docker compose --env-file .env -f ../../infra/docker-compose.yml up -d --wait
trap 'kill 0' INT TERM
sh scripts/with-env.sh go run ./cmd/api &
sh scripts/with-env.sh go run ./cmd/worker &
# The signer settles paid invoices and needs the executor key. Only its presence is checked; the value is never read here.
if grep -Eq "^[[:space:]]*(export[[:space:]]+)?EXECUTOR_PRIVATE_KEY=[\"']?[^\"'[:space:]#]" .env 2>/dev/null; then
  sh scripts/with-env.sh go run ./cmd/signer &
else
  echo "signer skipped: EXECUTOR_PRIVATE_KEY is not set in apps/backend/.env (paid invoices stay on their way until settled)"
fi
wait
