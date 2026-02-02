#!/usr/bin/env bash
set -euo pipefail

# openmux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/monotykamary/openmux/main/scripts/install.sh | bash

REPO="monotykamary/openmux"

# XDG Base Directory compliance
# https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
XDG_BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"

INSTALL_DIR="$XDG_BIN_HOME"
LIB_INSTALL_DIR="${XDG_DATA_HOME}/openmux"

# Global temp directory for cleanup trap (must be declared before trap with set -u)
TMP_DIR=""
cleanup() { [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Colors for output
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

spinner() {
    local pid=$1
    local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r  %s %s" "${spin:i++%${#spin}:1}" "$2"
        sleep 0.1
    done
    printf "\r\033[K"
}

error() {
    printf "  ${RED}✗${NC} %s\n" "$1" >&2
    exit 1
}

detect_platform() {
    local os arch

    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        Darwin) OS="darwin" ;;
        Linux) OS="linux" ;;
        *) error "Unsupported operating system: $os" ;;
    esac

    case "$arch" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac

    TARGET="${OS}-${ARCH}"

    # Library extension
    case "$OS" in
        darwin) LIB_EXT="dylib" ;;
        linux) LIB_EXT="so" ;;
    esac
}

get_latest_version() {
    if command -v curl &> /dev/null; then
        VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    elif command -v wget &> /dev/null; then
        VERSION=$(wget -qO- "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    else
        error "curl or wget is required"
    fi

    if [[ -z "$VERSION" ]]; then
        error "Failed to fetch latest version"
    fi
}

download_and_extract() {
    local url="https://github.com/$REPO/releases/download/$VERSION/openmux-$VERSION-$TARGET.tar.gz"

    TMP_DIR=$(mktemp -d)

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$LIB_INSTALL_DIR"

    # Download with spinner
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$TMP_DIR/openmux.tar.gz" 2>/dev/null &
    else
        wget -q "$url" -O "$TMP_DIR/openmux.tar.gz" 2>/dev/null &
    fi
    spinner $! "Downloading..."
    wait $! || error "Download failed"
    printf "  ${GREEN}✓${NC} Downloaded\n"

    # Extract with spinner
    tar -xzf "$TMP_DIR/openmux.tar.gz" -C "$TMP_DIR" &
    spinner $! "Extracting..."
    wait $!
    printf "  ${GREEN}✓${NC} Extracted\n"

    # Move libraries and binary to XDG data directory
    mv "$TMP_DIR/openmux-bin" "$LIB_INSTALL_DIR/"
    mv "$TMP_DIR/libzig_pty.$LIB_EXT" "$LIB_INSTALL_DIR/"
    mv "$TMP_DIR/libzig_git.$LIB_EXT" "$LIB_INSTALL_DIR/"
    mv "$TMP_DIR/libghostty-vt.$LIB_EXT" "$LIB_INSTALL_DIR/" || true
    mv "$TMP_DIR/bunfig.toml" "$LIB_INSTALL_DIR/" || true
    chmod +x "$LIB_INSTALL_DIR/openmux-bin"

    # Create wrapper script in XDG bin directory
    cat > "$INSTALL_DIR/openmux" << WRAPPER
#!/usr/bin/env bash
export ZIG_PTY_LIB="\${ZIG_PTY_LIB:-$LIB_INSTALL_DIR/libzig_pty.$LIB_EXT}"
export ZIG_GIT_LIB="\${ZIG_GIT_LIB:-$LIB_INSTALL_DIR/libzig_git.$LIB_EXT}"
export GHOSTTY_VT_LIB="\${GHOSTTY_VT_LIB:-$LIB_INSTALL_DIR/libghostty-vt.$LIB_EXT}"
export OPENMUX_VERSION="\${OPENMUX_VERSION:-$VERSION}"
export OPENMUX_ORIGINAL_CWD="\${OPENMUX_ORIGINAL_CWD:-\$(pwd)}"
cd "$LIB_INSTALL_DIR"
exec "./openmux-bin" "\$@"
WRAPPER
    chmod +x "$INSTALL_DIR/openmux"

    # Write version file
    echo "${VERSION#v}" > "$LIB_INSTALL_DIR/.version"

    printf "  ${GREEN}✓${NC} Installed binary to $INSTALL_DIR/openmux\n"
    printf "  ${GREEN}✓${NC} Installed libraries to $LIB_INSTALL_DIR/\n"
}

check_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        printf "\n"
        printf "  ${YELLOW}!${NC} Add to your PATH:\n"
        printf "\n"

        local shell_name
        shell_name=$(basename "$SHELL")

        case "$shell_name" in
            bash)
                printf "    echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc\n"
                printf "    source ~/.bashrc\n"
                ;;
            zsh)
                printf "    echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc\n"
                printf "    source ~/.zshrc\n"
                ;;
            fish)
                printf "    fish_add_path $INSTALL_DIR\n"
                ;;
            *)
                printf "    export PATH=\"$INSTALL_DIR:\$PATH\"\n"
                ;;
        esac
    fi
}

main() {
    printf "\n"
    printf "  ${BOLD}openmux${NC} installer\n"
    printf "\n"

    detect_platform
    get_latest_version

    printf "  Installing ${BOLD}openmux${NC} %s (%s)\n" "$VERSION" "$TARGET"
    printf "\n"

    download_and_extract
    check_path

    printf "\n"
    printf "  ${GREEN}Done!${NC} Run 'openmux' to start.\n"
    printf "\n"
}

main
