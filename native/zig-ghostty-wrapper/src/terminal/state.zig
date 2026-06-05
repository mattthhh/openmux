const std = @import("std");
const ghostty = @import("ghostty");
const response_handler = @import("response_handler.zig");

const Allocator = std.mem.Allocator;
const Terminal = ghostty.Terminal;
const RenderState = ghostty.RenderState;

pub const ResponseHandler = response_handler.ResponseHandler;
pub const ResponseStream = response_handler.ResponseStream;

/// Wrapper struct that owns the Terminal, stream, and RenderState.
///
/// Allocator scoping:
/// - `alloc` (gpa): General-purpose allocator scoped to this wrapper's lifetime.
///   All heap allocations by terminal, render_state, and response_buffer use this.
///   Created by new()/newWithConfig() and freed in free().
/// - `response_buffer`: Scratch buffer for DSR/DA/query responses.
///   Uses clearRetainingCapacity() between reads; grows as needed, never shrinks.
pub const TerminalWrapper = struct {
    /// gpa: scoped general-purpose allocator (c_allocator or wasm_allocator).
    /// For debug builds, tests use testing.allocator which provides
    /// leak, double-free, and use-after-free detection.
    alloc: Allocator,
    terminal: Terminal,
    stream: ResponseStream,
    render_state: RenderState,
    /// Scratch buffer for DSR and other query responses.
    response_buffer: std.ArrayList(u8),
    /// Track alternate screen state to detect screen switches
    last_screen_is_alternate: bool = false,
    /// Desired scrollback limit in lines (0 = unlimited)
    scrollback_limit_lines: usize = 0,
};
