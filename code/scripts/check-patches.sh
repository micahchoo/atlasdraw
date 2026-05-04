#!/usr/bin/env bash
# check-patches.sh — Fail CI if vendored Excalidraw files are modified without a
# corresponding entry in decisions/upstream-patches.md. Per ADR 0004.
#
# Usage:
#   CI:    BASE_SHA=<base> HEAD_SHA=<head> bash scripts/check-patches.sh
#   Local: bash scripts/check-patches.sh   (falls back to upstream/master...HEAD)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Vendored package paths — any file under these prefixes is gated
VENDORED_PREFIXES=(
  "packages/excalidraw/"
  "packages/element/"
  "packages/math/"
  "packages/common/"
  "packages/utils/"
)

PATCHES_DOC="decisions/upstream-patches.md"

# Compute the git range to diff
if [ -n "${BASE_SHA:-}" ] && [ -n "${HEAD_SHA:-}" ]; then
  GIT_RANGE="${BASE_SHA}...${HEAD_SHA}"
elif git rev-parse --verify upstream/master >/dev/null 2>&1; then
  GIT_RANGE="upstream/master...HEAD"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  GIT_RANGE="origin/main...HEAD"
else
  # No remote refs available — compare against last commit (safe local fallback)
  GIT_RANGE="HEAD~1...HEAD"
fi

# Get changed files in the range
CHANGED_FILES=$(git diff --name-only "${GIT_RANGE}" 2>/dev/null || true)

if [ -z "${CHANGED_FILES}" ]; then
  # No git history or nothing changed — skip silently
  exit 0
fi

# Filter to vendored files
VENDORED_CHANGED=()
while IFS= read -r file; do
  for prefix in "${VENDORED_PREFIXES[@]}"; do
    if [[ "${file}" == ${prefix}* ]]; then
      VENDORED_CHANGED+=("${file}")
      break
    fi
  done
done <<< "${CHANGED_FILES}"

if [ "${#VENDORED_CHANGED[@]}" -eq 0 ]; then
  # No vendored files changed — nothing to check
  exit 0
fi

# Vendored files changed: verify upstream-patches.md was also updated
PATCHES_UPDATED=false
while IFS= read -r file; do
  if [ "${file}" = "${PATCHES_DOC}" ]; then
    PATCHES_UPDATED=true
    break
  fi
done <<< "${CHANGED_FILES}"

if [ "${PATCHES_UPDATED}" = false ]; then
  echo "FAIL: Vendored file(s) changed without ${PATCHES_DOC} entry."
  echo "      Document the patch per ADR 0004 before merging."
  echo ""
  echo "      Changed vendored files:"
  for f in "${VENDORED_CHANGED[@]}"; do
    echo "        - ${f}"
  done
  exit 1
fi

COUNT="${#VENDORED_CHANGED[@]}"
echo "✓ ${COUNT} vendored file(s) changed AND ${PATCHES_DOC} updated"
exit 0
