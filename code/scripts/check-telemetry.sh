#!/usr/bin/env bash
# check-telemetry.sh — Fail CI if forbidden telemetry imports appear in OSS code.
# Per ADR 0006: the embed SDK and user-facing apps must never call home.
# Allowed exception: apps/storage with explicit opt-in comment on the same line.
#
# Usage: bash scripts/check-telemetry.sh (run from repo root)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Forbidden telemetry packages
FORBIDDEN_PATTERN='@sentry/|firebase|mixpanel|amplitude|google-analytics|posthog'

# Paths to scan (user-facing — must never call home)
SCAN_PATHS=()
for dir in apps/atlas-app/src apps/realtime/src packages/sdk/src; do
  if [ -d "${dir}" ]; then
    SCAN_PATHS+=("${dir}")
  fi
done

if [ "${#SCAN_PATHS[@]}" -eq 0 ]; then
  echo "✓ No scan paths found — skipping telemetry check"
  exit 0
fi

FAIL=0
VIOLATIONS=()

# Scan for forbidden imports, excluding opt-in annotated lines
while IFS= read -r match; do
  # Allow lines with explicit opt-in annotation (apps/storage only, but we exclude it from SCAN_PATHS)
  if echo "${match}" | grep -q '// telemetry-allowed: opt-in (ADR 0006)'; then
    continue
  fi
  VIOLATIONS+=("${match}")
  FAIL=1
done < <(grep -rEn "from ['\"]?(${FORBIDDEN_PATTERN})" "${SCAN_PATHS[@]}" \
           --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
           2>/dev/null || true)

if [ "${FAIL}" -eq 1 ]; then
  echo "FAIL: Forbidden telemetry import(s) found in OSS code (ADR 0006):"
  for v in "${VIOLATIONS[@]}"; do
    echo "  ${v}"
  done
  exit 1
fi

echo "✓ No forbidden telemetry imports in OSS scan paths"
exit 0
