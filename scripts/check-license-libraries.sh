#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Phase 6 A11/A12 — asset library license gate (cites OQ7).
#
# OQ7 (original Phase 6 §Task 14b Step 4):
#   "OpenMoji is CC BY-SA, game-icons.net is CC BY 3.0 — both fail MIT
#   compatibility. One-time audit is insufficient; make it a regression guard
#   so a future contributor adding a new fixture can't ship non-MIT assets
#   without CI failing."
#
# Original plan reference:
#   docs/superpowers/plans/2026-05-03-atlasdraw-phase-6-v1-embeds-comments.md
#   §Task 14b Step 4 — "Add CI license-scan guard"
#
# What this script enforces:
#   For every `*.excalidrawlib` file under packages/data/fixtures/libraries/,
#   there must be a sibling LICENSE file (named either `LICENSE.txt` for the
#   whole directory, or `<basename>.LICENSE.txt` per fixture) whose SPDX
#   identifier is one of: MIT, ISC, CC0-1.0, Unlicense.
#
#   Forbidden (causes non-zero exit):
#     - CC-BY-* (any CC-BY variant — game-icons.net, Font Awesome 4.x)
#     - CC-BY-SA-* (OpenMoji, Wikipedia)
#     - Any other SPDX or missing SPDX line
#
# Usage:
#   bash scripts/check-license-libraries.sh
# Exit:
#   0 — all fixtures pass
#   1 — at least one fixture is missing a LICENSE or cites a forbidden SPDX

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="${REPO_ROOT}/code/packages/data/fixtures/libraries"

ALLOWED_SPDX_REGEX='SPDX-License-Identifier:[[:space:]]+(MIT|ISC|CC0-1\.0|Unlicense)([[:space:]]|$)'

if [[ ! -d "${FIXTURES_DIR}" ]]; then
  echo "check-license-libraries: fixtures dir not found at ${FIXTURES_DIR}" >&2
  exit 1
fi

shopt -s nullglob
fixtures=("${FIXTURES_DIR}"/*.excalidrawlib)
shopt -u nullglob

if [[ ${#fixtures[@]} -eq 0 ]]; then
  echo "check-license-libraries: no .excalidrawlib fixtures found in ${FIXTURES_DIR}" >&2
  exit 1
fi

failures=0

for fixture in "${fixtures[@]}"; do
  base="$(basename "${fixture}" .excalidrawlib)"
  # Two license-file conventions accepted:
  #   1. Per-fixture: `<base>.LICENSE.txt`  (preferred when multiple fixtures share a dir)
  #   2. Per-dir:     `LICENSE.txt`         (single shared license for the dir)
  per_fixture_license="${FIXTURES_DIR}/${base}.LICENSE.txt"
  per_dir_license="${FIXTURES_DIR}/LICENSE.txt"
  license_file=""
  if [[ -f "${per_fixture_license}" ]]; then
    license_file="${per_fixture_license}"
  elif [[ -f "${per_dir_license}" ]]; then
    license_file="${per_dir_license}"
  fi

  if [[ -z "${license_file}" ]]; then
    echo "FAIL ${fixture}" >&2
    echo "     no LICENSE found — expected ${per_fixture_license} or ${per_dir_license}" >&2
    failures=$((failures + 1))
    continue
  fi

  # Reject forbidden SPDX explicitly before checking allowed ones — this gives
  # a clearer error message ("CC-BY-SA is forbidden") than a generic miss.
  if grep -E -q 'SPDX-License-Identifier:[[:space:]]+CC-BY-SA' "${license_file}"; then
    echo "FAIL ${fixture}" >&2
    echo "     ${license_file} cites CC-BY-SA — forbidden per OQ7 (not MIT-compatible)" >&2
    failures=$((failures + 1))
    continue
  fi
  if grep -E -q 'SPDX-License-Identifier:[[:space:]]+CC-BY-([1-9]|3\.0|4\.0)' "${license_file}"; then
    echo "FAIL ${fixture}" >&2
    echo "     ${license_file} cites CC-BY-* — forbidden per OQ7 (attribution incompatible with MIT bundle)" >&2
    failures=$((failures + 1))
    continue
  fi

  if ! grep -E -q "${ALLOWED_SPDX_REGEX}" "${license_file}"; then
    echo "FAIL ${fixture}" >&2
    echo "     ${license_file} does not cite an allowed SPDX identifier (MIT / ISC / CC0-1.0 / Unlicense)" >&2
    failures=$((failures + 1))
    continue
  fi

  echo "PASS ${base}.excalidrawlib  (${license_file##*/})"
done

if [[ ${failures} -gt 0 ]]; then
  echo "" >&2
  echo "check-license-libraries: ${failures} fixture(s) failed license check" >&2
  exit 1
fi

echo ""
echo "check-license-libraries: ${#fixtures[@]} fixture(s) passed"
exit 0
