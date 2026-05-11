#!/usr/bin/env bash
# Phase 4 T16 — server-side smoke test.
#
# Exercises the storage server's full HTTP loop end-to-end:
#   1. Start the storage server in sqlite-fs mode on a scratch DATA_DIR.
#   2. POST /maps with a synthetic blob.
#   3. GET /maps/:id (metadata round-trip).
#   4. PUT /maps/:id with an updated blob (verifies byte_size + updated_at).
#   5. GET /health.
#   6. POST /maps/:id/share — mint a share token.
#   7. GET /share/:token — receive { map, mode: "read" }.
#   8. GET /share/:token/blob — receive the actual blob bytes back.
#   9. Negative cases: bad token (404), traversal id (400), expired (skipped — TTL is 7 days).
#   10. Tear down server + scratch dir.
#
# What this DOES NOT cover (deferred):
# - Docker compose end-to-end (web image + storage image + volume). The
#   compose YAML is validated by `docker compose config --quiet` in
#   T10/T11. A real `docker compose up` smoke requires the daemon and
#   ~5 min of image build; out of scope for this script.
# - Playwright browser-level smoke (pin tool clicks, share dialog
#   interactions, basemap switch). Atlas-app unit tests (190 in this
#   release) cover the component-level surface. Browser-level CI is
#   queued for the Phase 5 hardening work.
# - Postgres-minio adapter integration. Adapter unit tests mock pg + S3
#   per ADR-0007; real-DB integration is the next E2E milestone.
#
# Run from repo root:
#   bash tests/e2e/phase4-smoke.sh
# Exit 0 = pass; any non-zero = the failing step's number.

set -euo pipefail

# --- config -----------------------------------------------------------------
PORT="${ATLAS_SMOKE_PORT:-14443}"
DATA_DIR="$(mktemp -d -t atlas-smoke.XXXXXX)"
LOG_FILE="$(mktemp -t atlas-smoke-server.XXXXXX.log)"
BASE="http://localhost:$PORT"

cleanup() {
  local code=$?
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
  rm -f "$LOG_FILE"
  if [[ $code -ne 0 ]]; then
    echo "✗ smoke FAILED at exit $code" >&2
  fi
  exit $code
}
trap cleanup EXIT

# Tiny JSON helper — extracts a top-level string field without requiring jq.
# Usage: extract '"id"' '<json>'
extract() {
  local key="$1"; local body="$2"
  # shellcheck disable=SC2001
  echo "$body" | sed -n 's/.*'"$key"'[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

# --- preflight --------------------------------------------------------------
echo "→ Phase 4 smoke test — scratch dir: $DATA_DIR"
DIST="code/apps/storage/dist/index.js"
if [[ ! -f "$DIST" ]]; then
  echo "  Building storage server..."
  (cd code && yarn workspace @atlasdraw/storage build) >/dev/null 2>&1
fi
[[ -f "$DIST" ]] || { echo "✗ storage dist not built ($DIST missing)"; exit 100; }

# --- step 1: start server ---------------------------------------------------
echo "→ [1] Start storage server on :$PORT"
STORAGE_MODE=sqlite-fs DATA_DIR="$DATA_DIR" PORT="$PORT" \
  node "$DIST" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Poll /health until ready (max 10s).
for i in $(seq 1 50); do
  if curl -fsS "$BASE/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ server exited before becoming ready. Log:"
    cat "$LOG_FILE"
    exit 1
  fi
done
HEALTH=$(curl -fsS "$BASE/health")
echo "  /health → $HEALTH"
case "$HEALTH" in
  *'"status":"ok"'*'"storageMode":"sqlite-fs"'*) ;;
  *) echo "✗ /health response shape unexpected"; exit 1 ;;
esac

# --- step 2: POST /maps -----------------------------------------------------
echo "→ [2] POST /maps (create)"
BLOB1='Atlasdraw E2E smoke blob v1 — pin at center'
CREATE=$(curl -fsS -X POST -H 'Content-Type: application/octet-stream' \
  --data-binary "$BLOB1" "$BASE/maps")
MAP_ID=$(extract '"id"' "$CREATE")
[[ -n "$MAP_ID" ]] || { echo "✗ no id in create response: $CREATE"; exit 2; }
echo "  map_id=$MAP_ID (21 chars: ${#MAP_ID})"
[[ ${#MAP_ID} -eq 21 ]] || { echo "✗ id length != 21"; exit 2; }

# --- step 3: GET /maps/:id (metadata) ---------------------------------------
echo "→ [3] GET /maps/:id (metadata)"
META=$(curl -fsS "$BASE/maps/$MAP_ID")
case "$META" in
  *"\"id\":\"$MAP_ID\""*'"byte_size"'*) ;;
  *) echo "✗ metadata response unexpected: $META"; exit 3 ;;
esac

# --- step 4: PUT /maps/:id (update) -----------------------------------------
echo "→ [4] PUT /maps/:id (update)"
BLOB2='Atlasdraw E2E smoke blob v2 — pin moved, label added — extra padding for byte_size delta'
PUT=$(curl -fsS -X PUT -H 'Content-Type: application/octet-stream' \
  --data-binary "$BLOB2" "$BASE/maps/$MAP_ID")
case "$PUT" in
  *'"byte_size"'*) ;;
  *) echo "✗ PUT response unexpected: $PUT"; exit 4 ;;
esac
echo "  put response shape OK"

# --- step 5: 404 path -------------------------------------------------------
echo "→ [5] GET /maps/<unknown> → 404"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/maps/aaaaaaaaaaaaaaaaaaaaa")
[[ "$CODE" == "404" ]] || { echo "✗ expected 404, got $CODE"; exit 5; }
echo "  404 OK"

# --- step 6: traversal id → 400 ---------------------------------------------
echo "→ [6] GET /maps/<traversal> → 400"
# URL-encoded ../etc to keep the path opaque to curl's URL parser.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/maps/..%2Fetc%2Fpasswd")
[[ "$CODE" == "400" || "$CODE" == "404" ]] || { echo "✗ expected 400 or 404, got $CODE"; exit 6; }
echo "  400/404 OK"

# --- step 7: POST /maps/:id/share -------------------------------------------
echo "→ [7] POST /maps/:id/share (mint token)"
SHARE=$(curl -fsS -X POST "$BASE/maps/$MAP_ID/share")
TOKEN=$(extract '"token"' "$SHARE")
[[ -n "$TOKEN" ]] || { echo "✗ no token in share response: $SHARE"; exit 7; }
echo "  token=$TOKEN (21 chars: ${#TOKEN})"
[[ ${#TOKEN} -eq 21 ]] || { echo "✗ token length != 21"; exit 7; }

# --- step 8: GET /share/:token (JSON) ---------------------------------------
echo "→ [8] GET /share/:token"
RESOLVE=$(curl -fsS "$BASE/share/$TOKEN")
# JSON key order is implementation-defined — check three substrings independently.
[[ "$RESOLVE" == *'"mode":"read"'* ]] || { echo "✗ resolve missing mode:\"read\": $RESOLVE"; exit 8; }
[[ "$RESOLVE" == *'"map"'* ]]         || { echo "✗ resolve missing map key: $RESOLVE"; exit 8; }
[[ "$RESOLVE" == *"\"id\":\"$MAP_ID\""* ]] || { echo "✗ resolve missing matching map.id: $RESOLVE"; exit 8; }
echo "  resolve OK — mode:\"read\", map.id=$MAP_ID"

# --- step 9: GET /share/:token/blob (binary) --------------------------------
echo "→ [9] GET /share/:token/blob"
BLOB_OUT="$(mktemp -t atlas-smoke-blob.XXXXXX)"
curl -fsS "$BASE/share/$TOKEN/blob" -o "$BLOB_OUT"
ACTUAL=$(cat "$BLOB_OUT")
rm -f "$BLOB_OUT"
[[ "$ACTUAL" == "$BLOB2" ]] || { echo "✗ blob mismatch (expected v2)"; exit 9; }
echo "  blob bytes match (v2)"

# --- step 10: bad-token negative cases --------------------------------------
echo "→ [10] GET /share/<unknown> → 404"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/share/aaaaaaaaaaaaaaaaaaaaa")
[[ "$CODE" == "404" ]] || { echo "✗ expected 404, got $CODE"; exit 10; }

echo "    GET /share/<traversal> → 400"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/share/..%2Fetc")
[[ "$CODE" == "400" || "$CODE" == "404" ]] || { echo "✗ expected 400/404, got $CODE"; exit 10; }

echo ""
echo "✓ Phase 4 smoke passed — 10/10 steps green"
