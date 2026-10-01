#!/usr/bin/env bash
# Smoke-test the minimal self-host stack: build it, start it, and prove that
# the web origin serves the app and proxies a save and a read to storage.
# Usage: infra/smoke-minimal.sh   (CI runs this; it tears the stack down.)
set -euo pipefail
cd "$(dirname "$0")"
project=atlasdraw-smoke
compose() { docker compose -p "$project" -f docker-compose.minimal.yml "$@"; }
trap 'compose logs --no-color | tail -50; compose down -v >/dev/null 2>&1' EXIT

compose up -d --build --wait --wait-timeout 180
base=http://localhost:3000

curl -fsS -o /dev/null "$base/"
curl -fsS "$base/api/health"
id=$(curl -fsS -X POST -H 'content-type: application/octet-stream' \
  --data-binary 'smoke' "$base/api/maps" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS "$base/api/maps/$id" | grep -q "\"id\":\"$id\""
echo "minimal stack OK (map $id)"
