#!/bin/sh
# Generates the API types from openapi.yaml; --check diffs a fresh generation against them instead.
set -eu
cd "$(dirname "$0")/.."
files="packages/node/src/openapi.gen.ts apps/web/src/shared/types/openapi.gen.ts apps/backend/internal/httpapi/openapi/openapi.gen.go"
out=$(pwd)
if [ "${1:-}" = --check ]; then
  out=$(mktemp -d)
  trap 'rm -rf "$out"' EXIT
  for f in $files; do mkdir -p "$out/$(dirname "$f")"; done
fi
spec=apps/backend/api/openapi.yaml
pnpm exec openapi-typescript "$spec" -o "$out/packages/node/src/openapi.gen.ts"
pnpm exec openapi-typescript "$spec" -o "$out/apps/web/src/shared/types/openapi.gen.ts"
go -C apps/backend tool oapi-codegen -config internal/httpapi/openapi/oapi-codegen.yaml \
  -o "$out/apps/backend/internal/httpapi/openapi/openapi.gen.go" api/openapi.yaml
[ "${1:-}" = --check ] || exit 0
status=0
for f in $files; do diff -u "$f" "$out/$f" || status=1; done
exit $status
