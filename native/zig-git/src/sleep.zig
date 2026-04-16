const std = @import("std");
const git_io = @import("io.zig");

pub fn sleepMilliseconds(ms: i64) void {
    std.Io.sleep(git_io.get(), std.Io.Duration.fromMilliseconds(ms), .awake) catch unreachable;
}
