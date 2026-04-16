const std = @import("std");

pub const Error = std.mem.Allocator.Error || error{ WuffsError, Overflow };

pub const ImageData = struct {
    width: u32,
    height: u32,
    data: []u8,
};

pub const png = struct {
    pub fn decode(_: std.mem.Allocator, _: []const u8) Error!ImageData {
        return error.WuffsError;
    }
};
