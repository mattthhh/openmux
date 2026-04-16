//! Thread-local std.Io provider for Zig 0.16.
//!
//! Zig 0.16 moved Mutex and Condition into std.Io, requiring an `io` parameter
//! for every lock/unlock/wait/signal call. Since zig-pty is a shared library
//! loaded via FFI (no main function with std.process.Init), we create our own
//! Io.Threaded instances per thread.

const std = @import("std");

/// Per-thread Io state. Each thread that uses Mutex/Condition must
/// call `initThreadIo()` before any locking operations.
const ThreadState = struct {
    threaded: std.Io.Threaded,
    io: std.Io,
    initialized: bool,
};

threadlocal var tls_state: ThreadState = .{
    .threaded = .init_single_threaded,
    .io = undefined,
    .initialized = false,
};

/// Initialize the thread-local Io for the current thread.
/// Must be called before any Mutex/Condition operations.
/// Safe to call multiple times (idempotent after first init).
pub fn initThreadIo() void {
    if (tls_state.initialized) return;
    tls_state.threaded = std.Io.Threaded.init(.failing, .{});
    tls_state.io = tls_state.threaded.io();
    tls_state.initialized = true;
}

/// Get the thread-local Io instance. Calls initThreadIo() if needed.
pub fn get() std.Io {
    if (!tls_state.initialized) initThreadIo();
    return tls_state.io;
}

/// Get a pointer to the thread-local Threaded instance.
pub fn getThreaded() *std.Io.Threaded {
    if (!tls_state.initialized) initThreadIo();
    return &tls_state.threaded;
}
