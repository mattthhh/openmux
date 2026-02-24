#!/bin/bash
# Quick test for Kitty graphics in scrollback
# Usage: ./scripts/quick-kitty-test.sh [number_of_lines]

LINES=${1:-10000}
IMAGE="assets/openmux-screenshot.png"

echo "=== Quick Kitty Scrollback Test ==="
echo "Spamming $LINES lines..."

# Generate lines
seq 1 $LINES | while read i; do
    echo "[$i] Filling scrollback buffer line $i/$LINES"
done

echo ""
echo "Displaying image with kitten icat..."

if command -v kitten &> /dev/null; then
    kitten icat --clear
    kitten icat "$IMAGE"
    echo ""
    echo "=== Image displayed! ==="
    echo "Scroll UP to see the image in scrollback"
    echo "Scroll down to return to the prompt"
else
    echo "kitten not found, trying imgcat..."
    imgcat "$IMAGE"
fi
