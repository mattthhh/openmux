//! Handle Registry for PTY management

const std = @import("std");
const Pty = @import("pty.zig").Pty;
const constants = @import("../util/constants.zig");
const pty_io = @import("../io.zig");
const sleep_util = @import("../util/sleep.zig");

const allocator = std.heap.c_allocator;

// Store heap-allocated PTY objects to avoid copying large structs with mutex /
// condition-variable state through the registry on spawn.
var handles: [constants.MAX_HANDLES]?*Pty = [_]?*Pty{null} ** constants.MAX_HANDLES;
var next_handle: u32 = 1;
var registry_mutex: std.Io.Mutex = .init;
var handle_ref_counts: [constants.MAX_HANDLES]std.atomic.Value(u32) = [_]std.atomic.Value(u32){std.atomic.Value(u32).init(0)} ** constants.MAX_HANDLES;
var handle_closing: [constants.MAX_HANDLES]std.atomic.Value(bool) = [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_HANDLES;

pub fn allocHandle() ?u32 {
    const io = pty_io.get();
    registry_mutex.lock(io) catch unreachable;
    defer registry_mutex.unlock(io);

    // Find free slot
    var i: u32 = 0;
    while (i < constants.MAX_HANDLES) : (i += 1) {
        const idx: u32 = @intCast((next_handle + i) % constants.MAX_HANDLES);
        if (idx == 0) continue; // Reserve 0 as invalid
        if (handles[idx] == null) {
            next_handle = idx + 1;
            return idx;
        }
    }
    return null;
}

pub fn acquireHandle(h: u32) ?*Pty {
    if (h == 0 or h >= constants.MAX_HANDLES) return null;
    const io = pty_io.get();
    registry_mutex.lock(io) catch unreachable;
    defer registry_mutex.unlock(io);

    if (handle_closing[h].load(.acquire)) return null;

    if (handles[h]) |pty| {
        _ = handle_ref_counts[h].fetchAdd(1, .acq_rel);
        return pty;
    }
    return null;
}

pub fn releaseHandle(h: u32) void {
    if (h == 0 or h >= constants.MAX_HANDLES) return;
    _ = handle_ref_counts[h].fetchSub(1, .acq_rel);
}

pub fn createHandle(h: u32) ?*Pty {
    if (h == 0 or h >= constants.MAX_HANDLES) return null;

    const pty = allocator.create(Pty) catch return null;

    const io = pty_io.get();
    registry_mutex.lock(io) catch unreachable;
    defer registry_mutex.unlock(io);

    if (handles[h] != null) {
        allocator.destroy(pty);
        return null;
    }

    handles[h] = pty;
    handle_ref_counts[h].store(0, .release);
    handle_closing[h].store(false, .release);
    return pty;
}

pub fn removeHandle(h: u32) void {
    if (h == 0 or h >= constants.MAX_HANDLES) return;

    const io = pty_io.get();

    // Mark handle as closing so new operations can't acquire it.
    registry_mutex.lock(io) catch unreachable;
    if (handles[h] == null or handle_closing[h].load(.acquire)) {
        registry_mutex.unlock(io);
        return;
    }
    handle_closing[h].store(true, .release);
    registry_mutex.unlock(io);

    // Wait for in-flight operations to complete.
    while (handle_ref_counts[h].load(.acquire) != 0) {
        sleep_util.sleepMilliseconds(1);
    }

    // Deinitialize outside the registry lock to avoid blocking other handles.
    var pty_ptr: *Pty = undefined;
    registry_mutex.lock(io) catch unreachable;
    if (handles[h]) |pty| {
        pty_ptr = pty;
    } else {
        handle_closing[h].store(false, .release);
        registry_mutex.unlock(io);
        return;
    }
    registry_mutex.unlock(io);

    pty_ptr.deinit();
    allocator.destroy(pty_ptr);

    registry_mutex.lock(io) catch unreachable;
    handles[h] = null;
    handle_ref_counts[h].store(0, .release);
    handle_closing[h].store(false, .release);
    registry_mutex.unlock(io);
}
