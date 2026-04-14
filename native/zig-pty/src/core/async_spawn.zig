//! Async Spawn Infrastructure
//! Allows PTY spawning on a background thread to avoid blocking the main thread

const std = @import("std");
const constants = @import("../util/constants.zig");
const spawn_module = @import("spawn.zig");
const handle_registry = @import("handle_registry.zig");

pub const SpawnState = enum(u8) {
    pending,
    complete,
    failed,
    cancelled,
    consumed,
};

/// Layout: bits 0-7 = slot index, bits 8-30 = generation (23 bits).
const SLOT_BITS: u32 = 8;
const GEN_SHIFT: u32 = SLOT_BITS;
const GEN_MASK: u32 = 0x7F_FFFF;

pub const SpawnRequest = struct {
    // Input parameters (copied to owned buffers)
    cmd: [constants.MAX_CMD_LEN]u8,
    cmd_len: usize,
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    env: [constants.MAX_ENV_LEN]u8,
    env_len: usize,
    cols: u16,
    rows: u16,
    // Output
    state: std.atomic.Value(SpawnState),
    result_handle: std.atomic.Value(c_int),
    generation: std.atomic.Value(u32),

    pub fn init() SpawnRequest {
        return .{
            .cmd = undefined,
            .cmd_len = 0,
            .cwd = undefined,
            .cwd_len = 0,
            .env = undefined,
            .env_len = 0,
            .cols = 0,
            .rows = 0,
            .state = std.atomic.Value(SpawnState).init(.failed),
            .result_handle = std.atomic.Value(c_int).init(0),
            .generation = std.atomic.Value(u32).init(0),
        };
    }
};

// Spawn request slots
var spawn_requests: [constants.MAX_SPAWN_REQUESTS]SpawnRequest = [_]SpawnRequest{SpawnRequest.init()} ** constants.MAX_SPAWN_REQUESTS;
var spawn_request_used: [constants.MAX_SPAWN_REQUESTS]std.atomic.Value(bool) = [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_SPAWN_REQUESTS;

// Spawn thread state
var spawn_thread: ?std.Thread = null;
var spawn_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var spawn_thread_mutex: std.Thread.Mutex = .{};
var spawn_queue_mutex: std.Thread.Mutex = .{};
var spawn_queue_cond: std.Thread.Condition = .{};
var spawn_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initSpawnThread() bool {
    // Fast path: already running
    if (spawn_thread_running.load(.acquire)) return true;

    spawn_thread_mutex.lock();
    defer spawn_thread_mutex.unlock();

    // Double-check under lock
    if (spawn_thread_running.load(.acquire)) return true;

    // Set running BEFORE spawning to avoid race where thread sees false and exits
    spawn_thread_running.store(true, .release);

    spawn_thread = std.Thread.spawn(.{}, spawnThreadLoop, .{}) catch {
        spawn_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitSpawnThread() void {
    spawn_thread_mutex.lock();
    defer spawn_thread_mutex.unlock();

    if (!spawn_thread_running.load(.acquire)) return;

    // Signal thread to stop
    spawn_thread_running.store(false, .release);

    // Wake the thread if waiting on condition
    spawn_queue_mutex.lock();
    spawn_queue_cond.signal();
    spawn_queue_mutex.unlock();

    // Join the thread
    if (spawn_thread) |thread| {
        thread.join();
        spawn_thread = null;
    }

    // Drain any slots still in use (pending, cancelled, or unconsumed).
    drainSpawnRequests();
}

fn spawnThreadLoop() void {
    while (spawn_thread_running.load(.acquire)) {
        // Wait for work
        spawn_queue_mutex.lock();
        while (spawn_queue_count.load(.acquire) == 0 and spawn_thread_running.load(.acquire)) {
            spawn_queue_cond.timedWait(&spawn_queue_mutex, 100 * std.time.ns_per_ms) catch {};
        }
        spawn_queue_mutex.unlock();

        if (!spawn_thread_running.load(.acquire)) break;

        // Process all pending requests
        for (&spawn_requests, 0..) |*req, i| {
            if (!spawn_request_used[i].load(.acquire)) continue;

            const state = req.state.load(.acquire);
            if (state == .cancelled) {
                freeSpawnRequestSlot(@intCast(i));
                _ = spawn_queue_count.fetchSub(1, .release);
                continue;
            }
            if (state != .pending) continue;

            // Do the actual spawn (this is the slow part we moved off main thread)
            const cmd_ptr: [*:0]const u8 = @ptrCast(req.cmd[0..req.cmd_len]);
            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);
            const env_ptr: [*:0]const u8 = @ptrCast(req.env[0..req.env_len]);

            const result = spawn_module.spawnPty(cmd_ptr, cwd_ptr, env_ptr, req.cols, req.rows);

            // Atomically try to transition from pending to complete/failed.
            // If this fails, spawnCancel already set state to cancelled.
            const new_state: SpawnState = if (result >= 0) .complete else .failed;

            if (req.state.cmpxchgStrong(.pending, new_state, .acq_rel, .acquire)) |_| {
                // CAS failed - request was cancelled while we were spawning.
                // Clean up the PTY handle if spawn succeeded, then free the slot.
                // (Cancel doesn't free pending slots - we do it here after noticing cancelled)
                if (result >= 0) {
                    handle_registry.removeHandle(@intCast(result));
                }
                freeSpawnRequestSlot(@intCast(i));
            } else {
                // CAS succeeded - store result for caller to retrieve via spawnPoll
                req.result_handle.store(result, .release);
            }

            _ = spawn_queue_count.fetchSub(1, .release);
        }
    }
}

/// Free all remaining used slots. Called after thread join during shutdown.
pub fn drainSpawnRequests() void {
    for (&spawn_request_used, 0..) |*used, i| {
        if (used.load(.acquire)) {
            freeSpawnRequestSlot(@intCast(i));
        }
    }
}

/// Allocate a request slot and return an encoded request ID.
pub fn allocSpawnRequest() ?c_int {
    for (&spawn_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                const old_gen = spawn_requests[i].generation.fetchAdd(1, .acq_rel);
                const gen = (old_gen + 1) & GEN_MASK;
                const encoded_id: c_int = @intCast(@as(u32, @intCast(i)) | (gen << GEN_SHIFT));
                return encoded_id;
            }
        }
    }
    return null;
}

/// Free a request slot by raw slot index (internal use).
pub fn freeSpawnRequestSlot(slot: u32) void {
    if (slot >= constants.MAX_SPAWN_REQUESTS) return;
    spawn_request_used[slot].store(false, .release);
    spawn_requests[slot].state.store(.failed, .release);
    spawn_requests[slot].result_handle.store(0, .release);
}

/// Backward-compatible alias: accepts an encoded request_id and extracts
/// the slot index. Used by callers that have already validated via
/// getSpawnRequest.
pub fn freeSpawnRequest(encoded_id: c_int) void {
    const slot: u32 = @as(u32, @intCast(encoded_id)) & ((@as(u32, 1) << SLOT_BITS) - 1);
    freeSpawnRequestSlot(slot);
}

/// Look up a request by encoded ID. Validates the generation counter
/// to reject stale IDs from freed-and-reallocated slots.
pub fn getSpawnRequest(encoded_id: c_int) ?*SpawnRequest {
    if (encoded_id < 0) return null;
    const id: u32 = @intCast(encoded_id);
    const slot: u32 = id & ((@as(u32, 1) << SLOT_BITS) - 1);
    const gen: u32 = (id >> GEN_SHIFT) & GEN_MASK;
    if (slot >= constants.MAX_SPAWN_REQUESTS) return null;
    if (!spawn_request_used[slot].load(.acquire)) return null;
    if ((spawn_requests[slot].generation.load(.acquire) & GEN_MASK) != gen) return null;
    return &spawn_requests[slot];
}

pub fn signalSpawnQueue() void {
    _ = spawn_queue_count.fetchAdd(1, .release);
    spawn_queue_cond.signal();
}
