#!/usr/bin/env bash
# check-license.sh — Fail CI if any workspace package.json has wrong or missing license.
# Per ADR 0002 (license split): AGPL-3.0-only for apps/root, MIT for SDK/CLI/vendored, MPL-2.0 for basemap/tools.
#
# Usage: run from repo root — bash scripts/check-license.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Per-package expected license map (path relative to repo root => expected license)
declare -A EXPECTED_LICENSE
EXPECTED_LICENSE["package.json"]="AGPL-3.0-only"
EXPECTED_LICENSE["apps/atlas-app/package.json"]="AGPL-3.0-only"
EXPECTED_LICENSE["apps/realtime/package.json"]="AGPL-3.0-only"
EXPECTED_LICENSE["packages/sdk/package.json"]="MIT"
EXPECTED_LICENSE["packages/cli/package.json"]="MIT"
EXPECTED_LICENSE["packages/geo/package.json"]="MIT"
EXPECTED_LICENSE["packages/data/package.json"]="MIT"
EXPECTED_LICENSE["packages/basemap/package.json"]="MPL-2.0"
EXPECTED_LICENSE["packages/tools/package.json"]="MPL-2.0"
# Vendored Excalidraw packages
EXPECTED_LICENSE["packages/excalidraw/package.json"]="MIT"
EXPECTED_LICENSE["packages/element/package.json"]="MIT"
EXPECTED_LICENSE["packages/math/package.json"]="MIT"
EXPECTED_LICENSE["packages/common/package.json"]="MIT"
EXPECTED_LICENSE["packages/utils/package.json"]="MIT"

FAIL=0
CHECKED=0

for pkg_path in "${!EXPECTED_LICENSE[@]}"; do
  if [ ! -f "${pkg_path}" ]; then
    # Package doesn't exist yet (e.g. apps/storage not landed) — skip silently
    continue
  fi

  expected="${EXPECTED_LICENSE[${pkg_path}]}"
  actual=$(node -e "try{const p=require('./${pkg_path}');process.stdout.write(p.license||'')}catch(e){}" 2>/dev/null || true)

  if [ -z "${actual}" ]; then
    echo "FAIL: ${pkg_path}  license=MISSING  expected=${expected}"
    FAIL=1
  elif [ "${actual}" != "${expected}" ]; then
    echo "FAIL: ${pkg_path}  license=${actual}  expected=${expected}"
    FAIL=1
  fi

  CHECKED=$((CHECKED + 1))
done

if [ "${FAIL}" -eq 0 ]; then
  echo "✓ All ${CHECKED} packages have correct license fields"
  exit 0
else
  exit 1
fi
