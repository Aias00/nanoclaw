#!/bin/bash
# Build the NanoClaw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
TAG="${1:-latest}"

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Auto-detect container runtime
if command -v container &> /dev/null; then
  RUNTIME="container"
  echo "Using Apple Container runtime"
elif command -v docker &> /dev/null; then
  RUNTIME="docker"
  echo "Using Docker runtime"
else
  echo "Error: Neither 'container' nor 'docker' command found"
  echo "Please install Apple Container or Docker"
  exit 1
fi

# Build with detected runtime
$RUNTIME build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo "Runtime: ${RUNTIME}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
