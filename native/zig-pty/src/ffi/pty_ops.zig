//! PTY Operations Module
//! Core operations for managing PTY sessions.
//!
//! All operations use the handle registry for safe concurrent access:
//! - acquireHandle: Gets a reference to the PTY, increments refcount
//! - releaseHandle: Decrements refcount (via defer)
//! - This prevents use-after-free when close races with other operations

const std = @import("std");
const constants = @import("../util/constants.zig");
const handle_registry = @import("../core/handle_registry.zig");
const posix = @import("../util/posix.zig");
const process_info = @import("process_info.zig");
const c = posix.c;

// ============================================================================
// PTY I/O Operations
// ============================================================================

/// Read available data from PTY ring buffer.
/// Returns: bytes read (>= 0), or ERROR (-1) on failure.
pub fn read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.readAvailable(buf, @intCast(len));
}

/// Write data to PTY.
/// Returns: bytes written (>= 0), or ERROR (-1) on failure.
pub fn write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    if (handle <= 0 or len <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.writeData(data, @intCast(len));
}

// ============================================================================
// PTY Control Operations
// ============================================================================

/// Resize PTY terminal dimensions.
/// Returns: SUCCESS (0) or ERROR (-1).
pub fn resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    if (handle <= 0 or cols <= 0 or rows <= 0) {
        return constants.ERROR;
    }
    // Bounds check: winsize uses u16 for dimensions
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.resize(@intCast(cols), @intCast(rows));
}

/// Resize PTY terminal dimensions with pixel size.
/// Returns: SUCCESS (0) or ERROR (-1).
pub fn resizeWithPixels(
    handle: c_int,
    cols: c_int,
    rows: c_int,
    pixel_width: c_int,
    pixel_height: c_int,
) c_int {
    if (handle <= 0 or cols <= 0 or rows <= 0 or pixel_width <= 0 or pixel_height <= 0) {
        return constants.ERROR;
    }
    if (cols > 65535 or rows > 65535) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.resizeWithPixels(
        @intCast(cols),
        @intCast(rows),
        @intCast(pixel_width),
        @intCast(pixel_height),
    );
}

/// Send SIGTERM to PTY child process.
/// Returns: SUCCESS (0) or ERROR (-1).
pub fn kill(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.kill();
}

/// Close PTY handle and release resources.
/// Safe to call multiple times (idempotent).
pub fn close(handle: c_int) void {
    if (handle <= 0) {
        return;
    }
    handle_registry.removeHandle(@intCast(handle));
}

// ============================================================================
// PTY Status Operations
// ============================================================================

/// Get PTY child process PID.
/// Returns: PID (> 0) or ERROR (-1).
pub fn getPid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.pid;
}

/// Duplicate the wakeup pipe read end for event-driven JS consumption.
/// The returned fd is owned by the caller and must be closed there.
pub fn dupWakeupFd(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.duplicateWakeReadFd();
}

/// Get PTY child exit code (after process exits).
/// Returns: exit code (>= 0) or ERROR (-1).
pub fn getExitCode(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    pty.checkChild();
    return pty.exit_code.load(.acquire);
}

// ============================================================================
// Foreground Process Detection
// ============================================================================

/// Get the foreground process ID for a PTY.
/// Uses tcgetpgrp() to identify the foreground process group, then
/// descends into the process tree past intermediate shells.
/// When tcgetpgrp() returns the shell's own PID, the kernel confirms
/// the shell is foreground — we return it directly without descending
/// the process tree. Descending from the shell would find live but
/// non-foreground children (e.g. a process doing cleanup after yielding
/// terminal control), causing stale process names in the UI.
/// Returns: foreground PID (> 0) or ERROR (-1).
pub fn getForegroundPid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    const pgid = c.tcgetpgrp(pty.master_fd);

    if (pgid > 0 and pgid != pty.pid) {
        // tcgetpgrp returned a non-shell PID — a child process has terminal
        // control. Descend past intermediate shells to find the actual
        // foreground app (e.g. login shell → interactive shell → mole).
        return process_info.findDeepestDescendant(pgid);
    }

    // tcgetpgrp returned the shell's own PID (or an error/same-PGID case).
    // The kernel confirms the shell is the foreground process. Return the
    // shell PID directly — do NOT descend the process tree. Descending
    // from the shell would find children that have already yielded terminal
    // control (e.g. a git process between tcsetpgrp(hand-back) and exit),
    // causing stale foreground process names.
    return pty.pid;
}

/// Get the number of times foreground process has changed.
/// Used by JS side to detect process changes without polling.
/// Returns: change count (>= 0) or ERROR (-1).
pub fn getForegroundChangeCount(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return @intCast(pty.foreground_change_count.load(.acquire));
}

/// Get the last seen foreground PID.
/// Returns: PID (> 0), 0 if not yet checked, or ERROR (-1).
pub fn getLastForegroundPid(handle: c_int) c_int {
    if (handle <= 0) {
        return constants.ERROR;
    }

    const h: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(h) orelse return constants.ERROR;
    defer handle_registry.releaseHandle(h);

    return pty.last_foreground_pid.load(.acquire);
}
