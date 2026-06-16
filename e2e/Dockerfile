# End-to-end clipboard environment that mirrors a fresh SSH box:
# Bun runtime, build tools, no xclip/xsel/wl-clipboard.
FROM oven/bun:1 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    cmake \
    python3 \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

# Install Zig (required for native zig-pty / zig-git builds used during tests)
ARG ZIG_VERSION=0.16.0
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
      amd64) ZIG_TARGET=x86_64-linux ;; \
      arm64) ZIG_TARGET=aarch64-linux ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}"; exit 1 ;; \
    esac \
  && curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_TARGET}-${ZIG_VERSION}.tar.xz" \
      -o /tmp/zig.tar.xz \
  && tar -xf /tmp/zig.tar.xz -C /usr/local \
  && ln -s "/usr/local/zig-${ZIG_TARGET}-${ZIG_VERSION}/zig" /usr/local/bin/zig \
  && rm /tmp/zig.tar.xz

WORKDIR /app

# Install dependencies first to leverage Docker layer caching.
# --ignore-scripts skips simple-git-hooks (no .git in the build context).
COPY package.json bun.lock ./
RUN bun install --ignore-scripts --frozen-lockfile

# Copy the rest of the source (including git submodules)
COPY . .

# Clean any host build artifacts that may contain absolute paths (e.g. macOS CMake cache).
RUN rm -rf \
    native/zig-pty/zig-out \
    native/zig-git/zig-out \
    native/zig-ghostty-wrapper/zig-out \
    native/zig-pty/.zig-cache \
    native/zig-git/.zig-cache \
    native/zig-ghostty-wrapper/.zig-cache

# Build native libs so the standard test harness can preload.
RUN cd native/zig-pty && bash ../../scripts/zig.sh build
RUN cd native/zig-git && bash ../../scripts/zig.sh build
RUN cd native/zig-ghostty-wrapper && bash ../../scripts/zig.sh build

# Sanity-check: none of the clipboard helpers should be present
RUN which xclip xsel wl-copy wl-paste 2>/dev/null && { echo "unexpected clipboard tool found"; exit 1; } || true

CMD ["bun", "test", "e2e/"]
