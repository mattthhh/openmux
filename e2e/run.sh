#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_TAG="openmux-clipboard-e2e:latest"

cd "$PROJECT_DIR"

echo "Building e2e Docker image..."
docker build -t "$IMAGE_TAG" -f "$SCRIPT_DIR/Dockerfile" .

echo "Running clipboard-over-ssh e2e tests..."
docker run --rm -it "$IMAGE_TAG" "$@"
