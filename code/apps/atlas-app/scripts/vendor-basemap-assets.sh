#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Copies the label glyphs and sprites of the offline basemaps (Light, Dark)
# into public/basemap/. The app serves them from its own origin, so a map
# with labels makes no third-party request.
#
# Source: protomaps/basemaps-assets at one pinned commit. To update, change
# COMMIT, run this script, and commit public/basemap/.
#
#   fonts/    the four Noto Sans stacks that protomaps-themes-base names
#             (Devanagari only inside text-field's format expressions),
#             all 256 ranges each (MapLibre fails a tile's labels when one
#             range is missing), and OFL.txt, their licence
#   sprites/  sprite set v4 (light, dark; 1x and 2x), the icons
#             protomaps-themes-base 4 draws. MIT, from tangrams/icons.
#
# Measured 2026-10-01: 11.3 MB on disk, 6.4 MB gzip. A session fetches only
# the ranges its labels use.
#
# Usage, from code/apps/atlas-app:  scripts/vendor-basemap-assets.sh
set -euo pipefail

REPO=https://github.com/protomaps/basemaps-assets.git
COMMIT=028c18f713baecad011301ff7a69acc39bcc2ae7
STACKS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"
  "Noto Sans Devanagari Regular v1")
SPRITES=(light dark)

here=$(cd "$(dirname "$0")/.." && pwd)
out="$here/public/basemap"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" fetch -q --depth 1 "$REPO" "$COMMIT"
git -C "$tmp" checkout -q FETCH_HEAD

rm -rf "$out"
mkdir -p "$out/fonts" "$out/sprites/v4"
for stack in "${STACKS[@]}"; do
  cp -r "$tmp/fonts/$stack" "$out/fonts/"
done
cp "$tmp/fonts/OFL.txt" "$out/fonts/"
for name in "${SPRITES[@]}"; do
  cp "$tmp/sprites/v4/$name".json "$tmp/sprites/v4/$name".png \
    "$tmp/sprites/v4/$name@2x".json "$tmp/sprites/v4/$name@2x".png \
    "$out/sprites/v4/"
done

echo "wrote $out ($(du -sh "$out" | cut -f1))"
