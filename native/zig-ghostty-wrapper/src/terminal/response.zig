const std = @import("std");
const state = @import("state.zig");

const TerminalWrapper = state.TerminalWrapper;

/// Check if there are pending responses from the terminal
pub fn hasResponse(ptr: ?*anyopaque) callconv(.c) bool {
    const wrapper: *const TerminalWrapper = @ptrCast(@alignCast(ptr orelse return false));
    return wrapper.response_buffer.items.len > 0;
}

/// Read pending responses from the terminal.
/// Returns number of bytes written to buffer, or 0 if no responses pending.
/// Returns -1 on error (null pointer or buffer too small).
pub fn readResponse(ptr: ?*anyopaque, out: [*]u8, buf_size: usize) callconv(.c) c_int {
    const wrapper: *TerminalWrapper = @ptrCast(@alignCast(ptr orelse return -1));
    const len = @min(wrapper.response_buffer.items.len, buf_size);
    if (len == 0) return 0;

    @memcpy(out[0..len], wrapper.response_buffer.items[0..len]);

    // Remove consumed bytes from buffer and release excess capacity.
    if (len == wrapper.response_buffer.items.len) {
        // Fully consumed — free backing memory to prevent capacity retention.
        wrapper.response_buffer.deinit(wrapper.alloc);
        wrapper.response_buffer = std.ArrayList(u8).empty;
    } else {
        // Partially consumed — shift remaining bytes to front.
        const remaining = wrapper.response_buffer.items.len - len;
        std.mem.copyForwards(
            u8,
            wrapper.response_buffer.items[0..remaining],
            wrapper.response_buffer.items[len .. len + remaining],
        );
        wrapper.response_buffer.shrinkAndFree(wrapper.alloc, remaining);
    }

    return @intCast(len);
}
