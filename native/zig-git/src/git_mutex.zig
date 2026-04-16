const std = @import("std");
const git_io = @import("io.zig");

pub var mutex: std.Io.Mutex = .init;

pub fn lock() void {
    mutex.lock(git_io.get()) catch unreachable;
}

pub fn unlock() void {
    mutex.unlock(git_io.get());
}
