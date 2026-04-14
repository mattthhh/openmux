const std = @import("std");

const constants = @import("constants.zig");
const repo_status = @import("repo_status.zig");

pub const StatusState = enum(u8) {
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

pub const StatusRequest = struct {
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    state: std.atomic.Value(StatusState),
    status: repo_status.RepoStatus,
    generation: std.atomic.Value(u32),

    pub fn init() StatusRequest {
        var status = repo_status.RepoStatus{};
        repo_status.clearRepoStatus(&status);
        return .{
            .cwd = undefined,
            .cwd_len = 0,
            .state = std.atomic.Value(StatusState).init(.failed),
            .status = status,
            .generation = std.atomic.Value(u32).init(0),
        };
    }
};

var status_requests: [constants.MAX_STATUS_REQUESTS]StatusRequest =
    [_]StatusRequest{StatusRequest.init()} ** constants.MAX_STATUS_REQUESTS;
var status_request_used: [constants.MAX_STATUS_REQUESTS]std.atomic.Value(bool) =
    [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_STATUS_REQUESTS;

var status_thread: ?std.Thread = null;
var status_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var status_thread_mutex: std.Thread.Mutex = .{};
var status_queue_mutex: std.Thread.Mutex = .{};
var status_queue_cond: std.Thread.Condition = .{};
var status_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initStatusThread() bool {
    if (status_thread_running.load(.acquire)) return true;

    status_thread_mutex.lock();
    defer status_thread_mutex.unlock();

    if (status_thread_running.load(.acquire)) return true;

    status_thread_running.store(true, .release);

    status_thread = std.Thread.spawn(.{}, statusThreadLoop, .{}) catch {
        status_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitStatusThread() void {
    status_thread_mutex.lock();
    defer status_thread_mutex.unlock();

    if (!status_thread_running.load(.acquire)) return;

    status_thread_running.store(false, .release);

    status_queue_mutex.lock();
    status_queue_cond.signal();
    status_queue_mutex.unlock();

    if (status_thread) |thread| {
        thread.join();
        status_thread = null;
    }

    // Drain any slots still in use (pending, cancelled, or unconsumed).
    drainStatusRequests();
}

fn statusThreadLoop() void {
    while (status_thread_running.load(.acquire)) {
        status_queue_mutex.lock();
        while (status_queue_count.load(.acquire) == 0 and status_thread_running.load(.acquire)) {
            status_queue_cond.timedWait(&status_queue_mutex, 100 * std.time.ns_per_ms) catch {};
        }
        status_queue_mutex.unlock();

        if (!status_thread_running.load(.acquire)) break;

        for (&status_requests, 0..) |*req, i| {
            if (!status_request_used[i].load(.acquire)) continue;

            const state = req.state.load(.acquire);
            if (state == .cancelled) {
                freeStatusRequestSlot(@intCast(i));
                _ = status_queue_count.fetchSub(1, .release);
                continue;
            }
            if (state != .pending) continue;

            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);
            const ok = repo_status.computeRepoStatus(cwd_ptr, &req.status);

            const new_state: StatusState = if (ok) .complete else .failed;

            if (req.state.cmpxchgStrong(.pending, new_state, .acq_rel, .acquire)) |_| {
                freeStatusRequestSlot(@intCast(i));
            }

            _ = status_queue_count.fetchSub(1, .release);
        }
    }
}

/// Free all remaining used slots. Called after thread join during shutdown.
pub fn drainStatusRequests() void {
    for (&status_request_used, 0..) |*used, i| {
        if (used.load(.acquire)) {
            freeStatusRequestSlot(@intCast(i));
        }
    }
}

/// Allocate a request slot and return an encoded request ID.
pub fn allocStatusRequest() ?c_int {
    for (&status_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                const old_gen = status_requests[i].generation.fetchAdd(1, .acq_rel);
                const gen = (old_gen + 1) & GEN_MASK;
                const encoded_id: c_int = @intCast(@as(u32, @intCast(i)) | (gen << GEN_SHIFT));
                return encoded_id;
            }
        }
    }
    return null;
}

/// Free a request slot by raw slot index (internal use).
pub fn freeStatusRequestSlot(slot: u32) void {
    if (slot >= constants.MAX_STATUS_REQUESTS) return;
    status_request_used[slot].store(false, .release);
    status_requests[slot].state.store(.failed, .release);
    repo_status.clearRepoStatus(&status_requests[slot].status);
}

/// Backward-compatible alias: accepts an encoded request_id and extracts
/// the slot index. Used by callers that have already validated via
/// getStatusRequest.
pub fn freeStatusRequest(encoded_id: c_int) void {
    const slot: u32 = @as(u32, @intCast(encoded_id)) & ((@as(u32, 1) << SLOT_BITS) - 1);
    freeStatusRequestSlot(slot);
}

/// Look up a request by encoded ID. Validates the generation counter
/// to reject stale IDs from freed-and-reallocated slots.
pub fn getStatusRequest(encoded_id: c_int) ?*StatusRequest {
    if (encoded_id < 0) return null;
    const id: u32 = @intCast(encoded_id);
    const slot: u32 = id & ((@as(u32, 1) << SLOT_BITS) - 1);
    const gen: u32 = (id >> GEN_SHIFT) & GEN_MASK;
    if (slot >= constants.MAX_STATUS_REQUESTS) return null;
    if (!status_request_used[slot].load(.acquire)) return null;
    if ((status_requests[slot].generation.load(.acquire) & GEN_MASK) != gen) return null;
    return &status_requests[slot];
}

pub fn signalStatusQueue() void {
    _ = status_queue_count.fetchAdd(1, .release);
    status_queue_cond.signal();
}
