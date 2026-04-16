//! Winsize helper utilities for PTY sizing

const std = @import("std");
const posix = @import("posix.zig");
const c = posix.c;

pub const DEFAULT_CELL_WIDTH: u16 = 8;
pub const DEFAULT_CELL_HEIGHT: u16 = 16;

pub fn makeWinsize(cols: u16, rows: u16) c.winsize {
    const max = std.math.maxInt(u16);
    const pixel_width = @min(@as(u32, cols) * DEFAULT_CELL_WIDTH, max);
    const pixel_height = @min(@as(u32, rows) * DEFAULT_CELL_HEIGHT, max);
    return makeWinsizeWithPixels(cols, rows, pixel_width, pixel_height);
}

pub fn makeWinsizeWithPixels(
    cols: u16,
    rows: u16,
    pixel_width: u32,
    pixel_height: u32,
) c.winsize {
    const max = std.math.maxInt(u16);
    return .{
        .col = cols,
        .row = rows,
        .xpixel = @intCast(@min(pixel_width, max)),
        .ypixel = @intCast(@min(pixel_height, max)),
    };
}
