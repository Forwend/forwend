#!/bin/sh
# Root `pnpm dev` runs this beside the web app. Ctrl+C stops both Go processes.
set -e
cd "$(dirname "$0")/.."
docker compose --env-file .env -f ../../infra/docker-compose.yml up -d --wait
trap 'kill 0' INT TERM
sh scripts/with-env.sh go run ./cmd/api &
sh scripts/with-env.sh go run ./cmd/worker &
wait
