#!/bin/bash
# Test script for Kitty graphics in scrollback
# Spams 10k lines to fill scrollback, then displays an image

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Kitty Graphics Scrollback Test ===${NC}"
echo ""

# Check if running in a supported terminal
if [ -z "$KITTY_WINDOW_ID" ] && [ -z "$GHOSTTY_RESOURCES_DIR" ]; then
    echo -e "${YELLOW}Warning: Not running in Kitty or Ghostty terminal${NC}"
    echo "This test requires a terminal with Kitty graphics protocol support"
    echo ""
fi

# Find the image
IMAGE_PATH="assets/openmux-screenshot.png"
if [ ! -f "$IMAGE_PATH" ]; then
    # Try alternative paths
    if [ -f "ssets/openmux-screenshot.png" ]; then
        IMAGE_PATH="ssets/openmux-screenshot.png"
    elif [ -f "../assets/openmux-screenshot.png" ]; then
        IMAGE_PATH="../assets/openmux-screenshot.png"
    elif [ -f "../ssets/openmux-screenshot.png" ]; then
        IMAGE_PATH="../ssets/openmux-screenshot.png"
    else
        echo -e "${RED}Error: Could not find openmux-screenshot.png${NC}"
        echo "Searched: assets/openmux-screenshot.png, ssets/openmux-screenshot.png"
        exit 1
    fi
fi

echo -e "${GREEN}Found image: $IMAGE_PATH${NC}"
echo ""

# Spam 10k lines to fill scrollback
echo -e "${YELLOW}Spamming 10,000 lines to fill scrollback...${NC}"
for i in $(seq 1 10000); do
    echo "[$i] This is line $i of 10000 - filling scrollback buffer with content"
done
echo -e "${GREEN}Done spamming lines${NC}"
echo ""

# Display the image using kitty's icat if available
if command -v kitten &> /dev/null; then
    echo -e "${YELLOW}Displaying image with kitten icat...${NC}"
    kitten icat "$IMAGE_PATH"
    echo ""
    echo -e "${GREEN}Image displayed!${NC}"
    echo ""
    echo "Instructions:"
    echo "  1. Scroll up to see the image in scrollback"
    echo "  2. The image should remain visible even when scrolled out of view"
    echo "  3. Scroll back down to return to the prompt"
elif command -v kitty &> /dev/null; then
    echo -e "${YELLOW}Displaying image with kitty icat...${NC}"
    kitty icat "$IMAGE_PATH"
    echo ""
    echo -e "${GREEN}Image displayed!${NC}"
    echo ""
    echo "Instructions:"
    echo "  1. Scroll up to see the image in scrollback"
    echo "  2. The image should remain visible even when scrolled out of view"
    echo "  3. Scroll back down to return to the prompt"
else
    echo -e "${YELLOW}kitty/kitten not found, trying imgcat...${NC}"
    if command -v imgcat &> /dev/null; then
        imgcat "$IMAGE_PATH"
    else
        echo -e "${RED}No image display tool found${NC}"
        echo "Please install kitty or imgcat to display images"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}Test complete!${NC}"
