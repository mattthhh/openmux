//! Async Spawn Tests
//! Tests for asynchronous PTY spawning functionality.

const std = @import("std");
const exports = @import("../ffi/exports.zig");
const constants = @import("../util/constants.zig");
const sleep_util = @import("../util/sleep.zig");

const DRAIN_TIMEOUT_MS: u64 = 10_000;
const POLL_TIMEOUT_MS: u64 = 15_000;

/// Poll an async spawn request until it reaches a terminal state.
/// Uses exponential backoff: starts at 1ms, caps at 200ms.
/// Returns the handle on success, or SPAWN_ERROR/SPAWN_PENDING on failure/timeout.
fn pollUntilComplete(request_id: c_int, timeout_ms: u64) c_int {
    var wait_ms: u64 = 1;
    var elapsed: u64 = 0;
    while (elapsed < timeout_ms) : ({
        elapsed += wait_ms;
        wait_ms = @min(wait_ms * 2, 200);
    }) {
        const result = exports.bun_pty_spawn_poll(request_id);
        if (result != constants.SPAWN_PENDING) return result;
        sleep_util.sleepMilliseconds(@intCast(wait_ms));
    }
    return constants.SPAWN_PENDING;
}

/// Drain all in-flight spawn requests, then verify the system can
/// successfully spawn a new PTY. This is the gold-standard check
/// that the async spawn subsystem is fully idle and functional.
fn drainAndWaitForFunctional() !void {
    try std.testing.expect(exports.bun_pty_spawn_drain(@intCast(DRAIN_TIMEOUT_MS)));

    const request_id = exports.bun_pty_spawn_async("true", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    const handle = pollUntilComplete(request_id, POLL_TIMEOUT_MS);
    try std.testing.expect(handle > 0);
    exports.bun_pty_close(handle);
}

// ============================================================================
// Async Spawn Flow Tests
// ============================================================================

test "async spawn basic flow" {
    const request_id = exports.bun_pty_spawn_async("echo async", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    const handle = pollUntilComplete(request_id, POLL_TIMEOUT_MS);
    try std.testing.expect(handle > 0);
    exports.bun_pty_close(handle);
}

test "async spawn with cwd" {
    const request_id = exports.bun_pty_spawn_async("pwd", "/tmp", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    const handle = pollUntilComplete(request_id, POLL_TIMEOUT_MS);
    try std.testing.expect(handle > 0);

    // Wait for output and verify
    sleep_util.sleepMilliseconds(200);
    var buf: [1024]u8 = undefined;
    const n = exports.bun_pty_read(handle, &buf, buf.len);
    if (n > 0) {
        const output = buf[0..@intCast(n)];
        try std.testing.expect(std.mem.find(u8, output, "tmp") != null);
    }

    exports.bun_pty_close(handle);
}

// ============================================================================
// Async Spawn Cancel Tests
// ============================================================================

test "async spawn cancel before completion" {
    const request_id = exports.bun_pty_spawn_async("sleep 10", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Cancel immediately (races with spawn thread — either outcome is valid)
    exports.bun_pty_spawn_cancel(request_id);

    // Poll should return error (cancelled or already freed)
    const result = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, result);
}

test "async spawn cancel after completion" {
    const request_id = exports.bun_pty_spawn_async("echo done", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Wait for the spawn to complete
    const result = pollUntilComplete(request_id, POLL_TIMEOUT_MS);
    try std.testing.expect(result > 0);

    // Now cancel the already-completed request — should close the handle cleanly
    exports.bun_pty_spawn_cancel(request_id);

    // Polling again should return error (slot was freed by cancel)
    const after = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, after);
}

// ============================================================================
// Async Spawn Invalid Input Tests
// ============================================================================

test "async spawn invalid dimensions returns error" {
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 0, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, 0));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", -1, 24));
    try std.testing.expectEqual(constants.ERROR, exports.bun_pty_spawn_async("echo", "", "", 80, -1));
}

test "async spawn poll invalid request returns error" {
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(-1));
    try std.testing.expectEqual(constants.SPAWN_ERROR, exports.bun_pty_spawn_poll(99999));
}

// ============================================================================
// Multiple Concurrent Async Spawns
// ============================================================================

test "multiple concurrent async spawns" {
    var request_ids: [4]c_int = undefined;
    var handles: [4]c_int = undefined;

    for (&request_ids, 0..) |*rid, i| {
        rid.* = exports.bun_pty_spawn_async("echo test", "", "", 80, 24);
        try std.testing.expect(rid.* >= 0);
        _ = i;
    }

    for (&handles, 0..) |*h, i| {
        h.* = pollUntilComplete(request_ids[i], POLL_TIMEOUT_MS);
        try std.testing.expect(h.* > 0);
    }

    for (handles) |h| {
        exports.bun_pty_close(h);
    }
}

// ============================================================================
// Cancel Race Condition Tests
// ============================================================================

test "cancel race: concurrent cancel and poll" {
    var i: usize = 0;
    while (i < 20) : (i += 1) {
        const request_id = exports.bun_pty_spawn_async("echo race", "", "", 80, 24);
        try std.testing.expect(request_id >= 0);

        // Race: try to cancel while spawn might be completing.
        // This should not corrupt state or leak handles.
        exports.bun_pty_spawn_cancel(request_id);

        // Poll should return error (cancelled or already freed)
        const result = exports.bun_pty_spawn_poll(request_id);
        try std.testing.expectEqual(constants.SPAWN_ERROR, result);
    }

    // Verify system is still in a good state after the race
    try drainAndWaitForFunctional();
}

test "cancel race: double cancel is safe" {
    const request_id = exports.bun_pty_spawn_async("sleep 10", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Cancel twice — should not crash or corrupt state
    exports.bun_pty_spawn_cancel(request_id);
    exports.bun_pty_spawn_cancel(request_id);

    // Poll should return error
    const result = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, result);
}

test "cancel race: rapid spawn cancel cycles" {
    var i: usize = 0;
    while (i < 30) : (i += 1) {
        const request_id = exports.bun_pty_spawn_async("true", "", "", 80, 24);
        if (request_id >= 0) {
            exports.bun_pty_spawn_cancel(request_id);
        }
    }

    // Drain all in-flight requests to verify the system recovers cleanly
    try std.testing.expect(exports.bun_pty_spawn_drain(@intCast(DRAIN_TIMEOUT_MS)));
}

test "cancelled requests free slots for reuse" {
    // Drain first to ensure a clean starting state
    try std.testing.expect(exports.bun_pty_spawn_drain(@intCast(DRAIN_TIMEOUT_MS)));

    var initial_ids: [constants.MAX_SPAWN_REQUESTS]c_int = undefined;
    for (&initial_ids) |*rid| {
        rid.* = exports.bun_pty_spawn_async("true", "", "", 80, 24);
        try std.testing.expect(rid.* >= 0);
    }

    // Cancel all — sets state to cancelled but doesn't free slots immediately.
    // The spawn thread will free them as it processes each cancellation.
    for (initial_ids) |rid| {
        exports.bun_pty_spawn_cancel(rid);
    }

    // Wait for the spawn thread to process all cancellations and free all slots.
    // This is the critical step that replaces the fragile sleep-based waiting.
    try std.testing.expect(exports.bun_pty_spawn_drain(@intCast(DRAIN_TIMEOUT_MS)));

    // All 64 slots should now be free — re-allocate them all
    var new_ids: [constants.MAX_SPAWN_REQUESTS]c_int = undefined;
    for (&new_ids) |*rid| {
        rid.* = exports.bun_pty_spawn_async("true", "", "", 80, 24);
        try std.testing.expect(rid.* >= 0);
    }

    // Clean up: cancel and drain
    for (new_ids) |rid| {
        exports.bun_pty_spawn_cancel(rid);
    }
    try drainAndWaitForFunctional();
}

test "cancel race: concurrent spawns with interleaved cancels" {
    try drainAndWaitForFunctional();

    const spawn_count: usize = 8;
    var request_ids: [spawn_count]c_int = undefined;

    for (&request_ids) |*rid| {
        rid.* = exports.bun_pty_spawn_async("echo interleave", "", "", 80, 24);
        try std.testing.expect(rid.* >= 0);
    }

    // Cancel every other one (racing with spawn thread)
    for (request_ids, 0..) |rid, i| {
        if (i % 2 == 0) {
            exports.bun_pty_spawn_cancel(rid);
        }
    }

    // Poll the non-cancelled ones until they complete
    for (request_ids, 0..) |rid, i| {
        if (i % 2 == 1) {
            const handle = pollUntilComplete(rid, POLL_TIMEOUT_MS);
            try std.testing.expect(handle > 0);
            exports.bun_pty_close(handle);
        }
    }

    // Cancelled ones should return error
    for (request_ids, 0..) |rid, i| {
        if (i % 2 == 0) {
            const result = exports.bun_pty_spawn_poll(rid);
            try std.testing.expectEqual(constants.SPAWN_ERROR, result);
        }
    }
}

test "cancel race: cancel from multiple threads" {
    try drainAndWaitForFunctional();

    const request_id = exports.bun_pty_spawn_async("sleep 10", "", "", 80, 24);
    try std.testing.expect(request_id >= 0);

    // Spawn multiple threads that all try to cancel the same request
    var threads: [4]std.Thread = undefined;
    var started: usize = 0;

    for (&threads) |*t| {
        t.* = std.Thread.spawn(.{}, struct {
            fn run(rid: c_int) void {
                exports.bun_pty_spawn_cancel(rid);
            }
        }.run, .{request_id}) catch continue;
        started += 1;
    }

    for (threads[0..started]) |t| {
        t.join();
    }

    // Poll should return error
    const result = exports.bun_pty_spawn_poll(request_id);
    try std.testing.expectEqual(constants.SPAWN_ERROR, result);
}
