const std = @import("std");
const pty_io = @import("../io.zig");

pub fn sleepMilliseconds(ms: i64) void {
    std.Io.sleep(pty_io.get(), std.Io.Duration.fromMilliseconds(ms), .awake) catch unreachable;
}
