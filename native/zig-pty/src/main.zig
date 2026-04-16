//! zig-pty: Pure Zig PTY implementation for Bun FFI
//!
//! A minimal, high-performance pseudoterminal library.
//! Uses direct POSIX calls - no external dependencies.
//!
//! Architecture:
//! - Background reader thread does blocking reads for natural data coalescing
//! - Ring buffer allows lock-free producer/consumer pattern
//! - Wakeup pipe notifies JS when new data or exit state is ready to drain
//!
//! Module structure:
//! - core/           Core PTY implementation
//!   - pty.zig       PTY handle with background reader
//!   - spawn.zig     PTY creation
//!   - async_spawn.zig  Background thread spawn
//!   - handle_registry.zig  Handle management
//!   - ring_buffer.zig  Lock-free SPSC ring buffer
//! - ffi/            FFI layer
//!   - exports.zig   FFI export implementations
//!   - pty_ops.zig   PTY operations
//!   - spawn_ops.zig Spawn operations
//!   - process_info.zig  Process inspection
//! - util/           Utilities
//!   - constants.zig Shared constants
//!   - posix.zig     POSIX bindings

const std = @import("std");
const exports = @import("ffi/exports.zig");
const pty_io = @import("io.zig");

// ============================================================================
// FFI Exports - These must be `export fn` to create symbols in the shared lib
// ============================================================================

export fn bun_pty_spawn(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return exports.bun_pty_spawn(cmd, cwd, env, cols, rows);
}

export fn bun_pty_spawn_async(
    cmd: [*:0]const u8,
    cwd: [*:0]const u8,
    env: [*:0]const u8,
    cols: c_int,
    rows: c_int,
) c_int {
    return exports.bun_pty_spawn_async(cmd, cwd, env, cols, rows);
}

export fn bun_pty_spawn_poll(request_id: c_int) c_int {
    return exports.bun_pty_spawn_poll(request_id);
}

export fn bun_pty_spawn_cancel(request_id: c_int) void {
    exports.bun_pty_spawn_cancel(request_id);
}

export fn bun_pty_read(handle: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_read(handle, buf, len);
}

export fn bun_pty_write(handle: c_int, data: [*]const u8, len: c_int) c_int {
    return exports.bun_pty_write(handle, data, len);
}

export fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    return exports.bun_pty_resize(handle, cols, rows);
}

export fn bun_pty_resize_with_pixels(
    handle: c_int,
    cols: c_int,
    rows: c_int,
    pixel_width: c_int,
    pixel_height: c_int,
) c_int {
    return exports.bun_pty_resize_with_pixels(handle, cols, rows, pixel_width, pixel_height);
}

export fn bun_pty_kill(handle: c_int) c_int {
    return exports.bun_pty_kill(handle);
}

export fn bun_pty_get_pid(handle: c_int) c_int {
    return exports.bun_pty_get_pid(handle);
}

export fn bun_pty_dup_wakeup_fd(handle: c_int) c_int {
    return exports.bun_pty_dup_wakeup_fd(handle);
}

export fn bun_pty_get_exit_code(handle: c_int) c_int {
    return exports.bun_pty_get_exit_code(handle);
}

export fn bun_pty_close(handle: c_int) void {
    exports.bun_pty_close(handle);
}

// ============================================================================
// Process Inspection
// ============================================================================

export fn bun_pty_get_foreground_pid(handle: c_int) c_int {
    return exports.bun_pty_get_foreground_pid(handle);
}

export fn bun_pty_get_cwd(pid: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_get_cwd(pid, buf, len);
}

export fn bun_pty_get_process_name(pid: c_int, buf: [*]u8, len: c_int) c_int {
    return exports.bun_pty_get_process_name(pid, buf, len);
}

// ============================================================================
// Foreground Process Change Tracking
// ============================================================================

export fn bun_pty_get_foreground_change_count(handle: c_int) c_int {
    return exports.bun_pty_get_foreground_change_count(handle);
}

export fn bun_pty_get_last_foreground_pid(handle: c_int) c_int {
    return exports.bun_pty_get_last_foreground_pid(handle);
}

// ============================================================================
// macOS notify(3) helpers
// ============================================================================

export fn bun_pty_notify_register(name: [*:0]const u8, out_token: *c_int) c_int {
    return exports.bun_pty_notify_register(name, out_token);
}

export fn bun_pty_notify_cancel(token: c_int) c_int {
    return exports.bun_pty_notify_cancel(token);
}

export fn bun_pty_notify_register_signal(name: [*:0]const u8, sig: c_int) c_int {
    return exports.bun_pty_notify_register_signal(name, sig);
}

// Initialize thread-local Io for the calling thread on library load
comptime {
    _ = pty_io;
}

// ============================================================================
// Tests
// ============================================================================

test {
    _ = @import("tests/main.zig");
}
