const std = @import("std");

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

pub fn initThreadIo() void {
    if (tls_state.initialized) return;
    tls_state.threaded = std.Io.Threaded.init(.failing, .{});
    tls_state.io = tls_state.threaded.io();
    tls_state.initialized = true;
}

pub fn get() std.Io {
    if (!tls_state.initialized) initThreadIo();
    return tls_state.io;
}
