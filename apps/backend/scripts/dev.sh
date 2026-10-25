#!/bin/sh
# Root `pnpm dev` runs this beside the web app. The worker, signer and webhooks start once the api answers: it applies
# the migrations they check.
set -e
cd "$(dirname "$0")/.."
# Only the key's presence is checked; the value is never read here.
if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?EXECUTOR_PRIVATE_KEY=[\"']?[^\"'[:space:]#]" .env 2>/dev/null; then
  echo "dev: EXECUTOR_PRIVATE_KEY is missing or empty in apps/backend/.env: the signer needs the funded executor key" \
    "(see .env.example)" >&2
  exit 1
fi
docker compose --env-file .env -f ../../infra/docker-compose.local.yml up -d --wait

tmp=$(mktemp -d)
pids=
stop() {
  kill $pids 2>/dev/null || true
  wait
  rm -rf "$tmp"
}
fail() {
  echo "dev: $1" >&2
  trap - INT TERM
  stop
  exit 1
}
trap 'stop; exit 130' INT TERM

go build -o "$tmp/" ./cmd/api ./cmd/worker ./cmd/signer ./cmd/webhooks || fail "go build failed"
# start: $! is then the binary's PID, not tail's.
start() {
  : >"$tmp/$1.log"
  tail -f "$tmp/$1.log" &
  pids="$pids $!"
  sh scripts/with-env.sh "$tmp/$1" >"$tmp/$1.log" 2>&1 &
  pids="$pids $!"
}
ready() {
  name=$1 pid=$2
  shift 2
  i=0
  until "$@"; do
    kill -0 "$pid" 2>/dev/null || fail "$name stopped before it was ready: its log is above"
    i=$((i + 1))
    [ "$i" -le 120 ] || fail "$name did not report ready within 120 s: its log is above"
    sleep 1
  done
}
api_up() {
  grep -q "api listening" "$tmp/api.log" && curl -fs -o /dev/null "http://127.0.0.1:$port/healthz"
}

port=$(sed -n 's/^API_ADDR=.*:\([0-9]*\).*/\1/p' .env | tail -n 1)
start api
api=$!
ready api "$api" api_up
start worker
worker=$!
start signer
signer=$!
start webhooks
webhooks=$!
ready worker "$worker" grep -q "worker ready" "$tmp/worker.log"
ready signer "$signer" grep -q "signer ready" "$tmp/signer.log"
ready webhooks "$webhooks" grep -q "webhooks ready" "$tmp/webhooks.log"
echo "dev: api, worker, signer and webhooks are ready"
while :; do
  kill -0 "$api" 2>/dev/null || fail "api stopped: its log is above"
  kill -0 "$worker" 2>/dev/null || fail "worker stopped: its log is above"
  kill -0 "$signer" 2>/dev/null || fail "signer stopped: its log is above"
  kill -0 "$webhooks" 2>/dev/null || fail "webhooks stopped: its log is above"
  sleep 2
done
