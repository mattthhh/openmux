#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_DIR/dist"
RPMBUILD_DIR="$PROJECT_DIR/dist/rpmbuild"
SPEC_FILE="$PROJECT_DIR/packaging/rpm/openmux.spec"

cd "$PROJECT_DIR"

if [[ ! -f "$DIST_DIR/openmux" || ! -f "$DIST_DIR/openmux-bin" ]]; then
    echo "Error: dist/openmux and dist/openmux-bin are required. Run ./scripts/build.sh first." >&2
    exit 1
fi

if ! command -v rpmbuild >/dev/null 2>&1; then
    echo "Error: rpmbuild not found. Install rpm-build first." >&2
    exit 1
fi

version="$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')"
rm -rf "$RPMBUILD_DIR"
mkdir -p "$RPMBUILD_DIR"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
mkdir -p "$RPMBUILD_DIR/SOURCES/dist"

cp \
    "$DIST_DIR/openmux" \
    "$DIST_DIR/openmux-bin" \
    "$DIST_DIR/libzig_pty.so" \
    "$DIST_DIR/libzig_git.so" \
    "$DIST_DIR/libghostty-vt.so" \
    "$DIST_DIR/bunfig.toml" \
    "$RPMBUILD_DIR/SOURCES/dist/"

if [[ -f "$DIST_DIR/libstdout-rewrite.so" ]]; then
    cp "$DIST_DIR/libstdout-rewrite.so" "$RPMBUILD_DIR/SOURCES/dist/"
fi

cp README.md LICENSE "$RPMBUILD_DIR/SOURCES/"
cp "$SPEC_FILE" "$RPMBUILD_DIR/SPECS/openmux.spec"

rpmbuild \
    --define "_topdir $RPMBUILD_DIR" \
    --define "_openmux_version $version" \
    -bb "$RPMBUILD_DIR/SPECS/openmux.spec"

rpm_path="$(find "$RPMBUILD_DIR/RPMS" -type f -name 'openmux-*.rpm' | head -1)"
if [[ -z "$rpm_path" ]]; then
    echo "Error: RPM build completed but no RPM was produced." >&2
    exit 1
fi

rpm_name="openmux-v${version}-linux-x64-redhat8.rpm"
cp "$rpm_path" "$DIST_DIR/$rpm_name"
echo "Created: $DIST_DIR/$rpm_name"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "rpm_name=$rpm_name" >> "$GITHUB_OUTPUT"
    echo "rpm_path=$DIST_DIR/$rpm_name" >> "$GITHUB_OUTPUT"
fi
