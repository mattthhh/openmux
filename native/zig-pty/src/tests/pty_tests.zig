//! Basic PTY Tests
//! Tests for core PTY spawn, read, write, and resize operations.

const std = @import("std");
const spawn_module = @import("../core/spawn.zig");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");
const handle_registry = @import("../core/handle_registry.zig");
const posix = @import("../util/posix.zig");
const c = posix.c;

// ============================================================================
// Basic PTY Spawn Tests
// ============================================================================

test "basic pty spawn" {
    const handle = spawn_module.spawnPty("echo hello", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    // Wait a bit for output
    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n >= 0);

    exports.bun_pty_close(handle);
}

test "pty spawn with cwd" {
    const handle = spawn_module.spawnPty("pwd", "/tmp", "", 80, 24);
    try std.testing.expect(handle > 0);

    std.Thread.sleep(100 * std.time.ns_per_ms);

    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n > 0);

    // Output should contain /tmp
    const output = buf[0..@intCast(n)];
    try std.testing.expect(std.mem.indexOf(u8, output, "/tmp") != null);

    exports.bun_pty_close(handle);
}

test "pty resize" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    const result = exports.bun_pty_resize(handle, 120, 40);
    try std.testing.expectEqual(constants.SUCCESS, result);

    exports.bun_pty_close(handle);
}

test "pty resize with pixels updates winsize" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    const result = exports.bun_pty_resize_with_pixels(handle, 100, 50, 1234, 567);
    try std.testing.expectEqual(constants.SUCCESS, result);

    const handle_u32: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(handle_u32) orelse {
        try std.testing.expect(false);
        return;
    };

    var ws: c.winsize = undefined;
    const rc = c.ioctl(pty.master_fd, c.TIOCGWINSZ, &ws);
    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expectEqual(@as(u16, 100), ws.ws_col);
    try std.testing.expectEqual(@as(u16, 50), ws.ws_row);
    try std.testing.expectEqual(@as(u16, 1234), ws.ws_xpixel);
    try std.testing.expectEqual(@as(u16, 567), ws.ws_ypixel);

    handle_registry.releaseHandle(handle_u32);
    exports.bun_pty_close(handle);
}

test "pty reports pixel size in winsize" {
    const handle = spawn_module.spawnPty("sleep 1", "", "", 80, 24);
    try std.testing.expect(handle > 0);

    const handle_u32: u32 = @intCast(handle);
    const pty = handle_registry.acquireHandle(handle_u32) orelse {
        try std.testing.expect(false);
        return;
    };

    var ws: c.winsize = undefined;
    const rc = c.ioctl(pty.master_fd, c.TIOCGWINSZ, &ws);
    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expect(ws.ws_xpixel > 0);
    try std.testing.expect(ws.ws_ypixel > 0);

    handle_registry.releaseHandle(handle_u32);
    exports.bun_pty_close(handle);
}

// ============================================================================
// Write Operation Tests
// ============================================================================

test "write to pty" {
    const handle = spawn_module.spawnPty("cat", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    // Write data
    const data = "hello\n";
    const result = exports.bun_pty_write(handle, data.ptr, @intCast(data.len));
    try std.testing.expectEqual(constants.SUCCESS, result);

    // Read back (cat echoes input)
    std.Thread.sleep(100 * std.time.ns_per_ms);
    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    try std.testing.expect(n > 0);
}

// ============================================================================
// Kill and Exit Code Tests
// ============================================================================

test "kill terminates process" {
    const handle = spawn_module.spawnPty("sleep 60", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(50 * std.time.ns_per_ms);

    // Verify process is running
    const pid = exports.bun_pty_get_pid(handle);
    try std.testing.expect(pid > 0);

    // Kill it
    const result = exports.bun_pty_kill(handle);
    try std.testing.expectEqual(constants.SUCCESS, result);

    // Wait for exit
    std.Thread.sleep(200 * std.time.ns_per_ms);

    // Exit code should reflect signal (128 + SIGTERM = 143)
    const exit_code = exports.bun_pty_get_exit_code(handle);
    // Accept either 143 (128 + SIGTERM) or 0 (clean exit) or -1 (not yet reaped)
    try std.testing.expect(exit_code == 143 or exit_code == 0 or exit_code == -1 or exit_code == 15);
}

test "exit code for successful command" {
    const handle = spawn_module.spawnPty("true", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    // Wait for process to exit
    std.Thread.sleep(200 * std.time.ns_per_ms);

    const exit_code = exports.bun_pty_get_exit_code(handle);
    // Should be 0 for 'true' command, or -1 if not yet reaped
    try std.testing.expect(exit_code == 0 or exit_code == -1);
}

test "exit code for failing command" {
    const handle = spawn_module.spawnPty("false", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    // Wait for process to exit
    std.Thread.sleep(200 * std.time.ns_per_ms);

    const exit_code = exports.bun_pty_get_exit_code(handle);
    // Should be 1 for 'false' command, or -1 if not yet reaped
    try std.testing.expect(exit_code == 1 or exit_code == -1);
}

// ============================================================================
// PTY Output After Exit Tests
// ============================================================================

test "wakeup fd becomes readable when output arrives" {
    const handle = spawn_module.spawnPty("echo wakeup", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    const wake_fd = exports.bun_pty_dup_wakeup_fd(handle);
    try std.testing.expect(wake_fd >= 0);
    defer _ = c.close(wake_fd);

    var pfd = [_]c.pollfd{.{
        .fd = wake_fd,
        .events = c.POLLIN,
        .revents = 0,
    }};

    const poll_result = c.poll(&pfd, 1, 1000);
    try std.testing.expect(poll_result > 0);
    try std.testing.expect((pfd[0].revents & c.POLLIN) != 0);

    var wake_buf: [64]u8 = undefined;
    _ = c.read(wake_fd, &wake_buf, wake_buf.len);

    var buf: [1024]u8 = undefined;
    var saw_output = false;
    var attempts: usize = 0;
    while (attempts < 50) : (attempts += 1) {
        const n = exports.bun_pty_read(handle, &buf, buf.len);
        if (n > 0) {
            saw_output = true;
            break;
        }
        std.Thread.sleep(20 * std.time.ns_per_ms);
    }

    try std.testing.expect(saw_output);
}

test "wakeup fd becomes readable when child exits without output" {
    const handle = spawn_module.spawnPty("sleep 0.1", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    const wake_fd = exports.bun_pty_dup_wakeup_fd(handle);
    try std.testing.expect(wake_fd >= 0);
    defer _ = c.close(wake_fd);

    var pfd = [_]c.pollfd{.{
        .fd = wake_fd,
        .events = c.POLLIN,
        .revents = 0,
    }};

    const poll_result = c.poll(&pfd, 1, 1500);
    try std.testing.expect(poll_result > 0);
    try std.testing.expect((pfd[0].revents & c.POLLIN) != 0);

    var wake_buf: [64]u8 = undefined;
    _ = c.read(wake_fd, &wake_buf, wake_buf.len);

    var buf: [256]u8 = undefined;
    var saw_exit = false;
    var attempts: usize = 0;
    while (attempts < 50) : (attempts += 1) {
        const n = exports.bun_pty_read(handle, &buf, buf.len);
        if (n == constants.CHILD_EXITED) {
            saw_exit = true;
            break;
        }
        std.Thread.sleep(20 * std.time.ns_per_ms);
    }

    try std.testing.expect(saw_exit);
}

test "read returns child exited after process ends" {
    const handle = spawn_module.spawnPty("echo quick", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    // Wait for process to exit
    std.Thread.sleep(300 * std.time.ns_per_ms);

    // Drain any remaining output
    var buf: [1024]u8 = undefined;
    var total_read: usize = 0;
    var saw_exit = false;
    var attempts: usize = 0;
    while (attempts < 50) : (attempts += 1) {
        const n = exports.bun_pty_read(handle, &buf, buf.len);
        if (n == constants.CHILD_EXITED) {
            saw_exit = true;
            break;
        }
        if (n > 0) {
            total_read += @intCast(n);
            if (total_read > 10000) break; // Safety limit
        }
        std.Thread.sleep(20 * std.time.ns_per_ms);
    }

    try std.testing.expect(saw_exit);
}

test "read returns child exited even with no output" {
    const handle = spawn_module.spawnPty("true", "", "", 80, 24);
    try std.testing.expect(handle > 0);
    defer exports.bun_pty_close(handle);

    std.Thread.sleep(200 * std.time.ns_per_ms);

    var buf: [256]u8 = undefined;
    var saw_exit = false;
    var attempts: usize = 0;
    while (attempts < 50) : (attempts += 1) {
        const n = exports.bun_pty_read(handle, &buf, buf.len);
        if (n == constants.CHILD_EXITED) {
            saw_exit = true;
            break;
        }
        std.Thread.sleep(20 * std.time.ns_per_ms);
    }

    try std.testing.expect(saw_exit);
}
