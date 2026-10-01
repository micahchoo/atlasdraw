#!/usr/bin/env bash
# Smoke-test the minimal self-host stack: build it, start it, and prove that
# the web origin serves the app and proxies the write-key flow to storage:
# create, owner read, refused write, share, and a share that follows a save.
# Usage: infra/smoke-minimal.sh   (CI runs this; it tears the stack down.)
set -euo pipefail
cd "$(dirname "$0")"
project=atlasdraw-smoke
compose() { docker compose -p "$project" -f docker-compose.minimal.yml "$@"; }
trap 'compose logs --no-color | tail -50; compose down -v >/dev/null 2>&1' EXIT

compose up -d --build --wait --wait-timeout 180
base=http://localhost:3000

# Docker reports the web container healthy as soon as it starts; nginx may
# not accept connections yet. Wait for the first answer, then test.
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$base/" && break
  sleep 1
done
curl -fsS -o /dev/null "$base/"
curl -fsS "$base/api/health"
created=$(curl -fsS -X POST -H 'content-type: application/octet-stream' \
  --data-binary 'smoke' "$base/api/maps")
field() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
id=$(field id <<<"$created")
key=$(field write_key <<<"$created")

# The owner reads the backup back with the write key.
test "$(curl -fsS -H "Authorization: Bearer $key" "$base/api/maps/$id/blob")" = smoke
# A write with no key is refused.
code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT \
  -H 'content-type: application/octet-stream' --data-binary 'defaced' \
  "$base/api/maps/$id")
test "$code" = 401
# A share link serves the latest bytes.
token=$(curl -fsS -X POST -H "Authorization: Bearer $key" \
  "$base/api/maps/$id/share" | field token)
curl -fsS -X PUT -H "Authorization: Bearer $key" \
  -H 'content-type: application/octet-stream' --data-binary 'smoke v2' \
  "$base/api/maps/$id" >/dev/null
test "$(curl -fsS "$base/api/share/$token/blob")" = 'smoke v2'
echo "minimal stack OK (map $id)"
