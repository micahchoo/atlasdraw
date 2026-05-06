#!/usr/bin/env bash
# Build atlas-app Docker image locally and push to GHCR.
# Usage: ./scripts/docker-push.sh [sha]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA="${1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
IMAGE="ghcr.io/micahchoo/atlasdraw"

echo "==> Building $IMAGE:$SHA"
docker build \
  --platform linux/amd64 \
  -t "$IMAGE:latest" \
  -t "$IMAGE:$SHA" \
  "$REPO_ROOT/code"

echo "==> Pushing $IMAGE"
docker push "$IMAGE:latest"
docker push "$IMAGE:$SHA"

echo "==> Done: $IMAGE:$SHA"
