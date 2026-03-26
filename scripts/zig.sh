#!/usr/bin/env bash
set -euo pipefail

# Work around Zig 0.15.x failing to link its macOS build runner against the
# Xcode 26 SDK, whose libSystem.tbd may omit arm64-macos stubs. When that
# happens, prefer the Command Line Tools SDK, which still exposes the arm64
# entries Zig expects.
if [[ "$(uname -s)" == "Darwin" ]] && [[ -z "${DEVELOPER_DIR:-}" ]]; then
    clt_dir="/Library/Developer/CommandLineTools"
    clt_libsystem="$clt_dir/SDKs/MacOSX.sdk/usr/lib/libSystem.tbd"

    if [[ -f "$clt_libsystem" ]] && command -v xcrun &> /dev/null; then
        active_sdk="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null || true)"
        active_libsystem="${active_sdk:+$active_sdk/usr/lib/libSystem.tbd}"

        active_header="$(head -n 5 "$active_libsystem" 2>/dev/null || true)"
        clt_header="$(head -n 5 "$clt_libsystem" 2>/dev/null || true)"

        if [[ -f "$active_libsystem" ]] && [[ "$active_header" != *"arm64-macos"* ]] && [[ "$clt_header" == *"arm64-macos"* ]]; then
            export DEVELOPER_DIR="$clt_dir"
            echo "Using Command Line Tools SDK for Zig (active macOS SDK lacks arm64-macos libSystem stubs)." >&2
        fi
    fi
fi

exec zig "$@"
