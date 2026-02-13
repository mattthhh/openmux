const std = @import("std");
const Allocator = std.mem.Allocator;
const ghostty = @import("ghostty");
const lib_alloc = @import("allocator.zig");
const CAllocator = lib_alloc.Allocator;
const Result = @import("result.zig").Result;

const KeyAction = ghostty.input.KeyAction;
const Key = ghostty.input.Key;
const KeyEvent = ghostty.input.KeyEvent;
const KeyMods = ghostty.input.KeyMods;

const log = std.log.scoped(.key_event);

const PoisonAllocator = struct {
    inner: std.mem.Allocator,
    last_freed_ptr: ?[*]const u8 = null,
    last_freed_len: usize = 0,
    free_count: usize = 0,

    const vtable: lib_alloc.VTable = .{
        .alloc = allocFn,
        .resize = resizeFn,
        .remap = remapFn,
        .free = freeFn,
    };

    fn toC(self: *PoisonAllocator) lib_alloc.Allocator {
        return .{
            .ctx = self,
            .vtable = &vtable,
        };
    }

    fn fromAlignment(alignment: u8) std.mem.Alignment {
        return @enumFromInt(alignment);
    }

    fn allocFn(
        ctx: *anyopaque,
        len: usize,
        alignment: u8,
        ra: usize,
    ) callconv(.c) ?[*]u8 {
        const self: *PoisonAllocator = @ptrCast(@alignCast(ctx));
        return self.inner.rawAlloc(len, fromAlignment(alignment), ra);
    }

    fn resizeFn(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        new_len: usize,
        ra: usize,
    ) callconv(.c) bool {
        const self: *PoisonAllocator = @ptrCast(@alignCast(ctx));
        return self.inner.rawResize(memory[0..memory_len], fromAlignment(alignment), new_len, ra);
    }

    fn remapFn(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        new_len: usize,
        ra: usize,
    ) callconv(.c) ?[*]u8 {
        _ = memory;
        _ = memory_len;
        _ = alignment;
        _ = new_len;
        _ = ra;
        _ = ctx;
        return null;
    }

    fn freeFn(
        ctx: *anyopaque,
        memory: [*]u8,
        memory_len: usize,
        alignment: u8,
        ra: usize,
    ) callconv(.c) void {
        const self: *PoisonAllocator = @ptrCast(@alignCast(ctx));
        const bytes = memory[0..memory_len];
        if (bytes.len > 0) {
            self.last_freed_ptr = bytes.ptr;
            self.last_freed_len = bytes.len;
            self.free_count += 1;
            @memset(bytes, 0xA5);
        }
        self.inner.rawFree(bytes, fromAlignment(alignment), ra);
    }
};

/// Wrapper around KeyEvent that tracks the allocator for C API usage.
/// UTF-8 text is copied into owned storage so callers don't need to keep
/// their input buffer alive after set_utf8 returns.
const KeyEventWrapper = struct {
    event: KeyEvent = .{},
    alloc: Allocator,
    utf8_owned: std.ArrayList(u8) = .empty,
    /// Stable readback storage for get_utf8 pointers.
    /// This avoids returning pointers into utf8_owned, which can reallocate on set_utf8.
    utf8_readback: std.ArrayList(u8) = .empty,
};

/// C: GhosttyKeyEvent
pub const Event = ?*KeyEventWrapper;

pub fn new(
    alloc_: ?*const CAllocator,
    result: *Event,
) callconv(.c) Result {
    const alloc = lib_alloc.default(alloc_);
    const ptr = alloc.create(KeyEventWrapper) catch
        return .out_of_memory;
    ptr.* = .{
        .alloc = alloc,
        .utf8_owned = .empty,
        .utf8_readback = .empty,
    };
    result.* = ptr;
    return .success;
}

pub fn free(event_: Event) callconv(.c) void {
    const wrapper = event_ orelse return;
    const alloc = wrapper.alloc;
    wrapper.utf8_readback.deinit(alloc);
    wrapper.utf8_owned.deinit(alloc);
    alloc.destroy(wrapper);
}

pub fn set_action(event_: Event, action: KeyAction) callconv(.c) void {
    if (comptime std.debug.runtime_safety) {
        _ = std.meta.intToEnum(KeyAction, @intFromEnum(action)) catch {
            log.warn("set_action invalid action value={d}", .{@intFromEnum(action)});
            return;
        };
    }

    const event: *KeyEvent = &event_.?.event;
    event.action = action;
}

pub fn get_action(event_: Event) callconv(.c) KeyAction {
    const event: *KeyEvent = &event_.?.event;
    return event.action;
}

pub fn set_key(event_: Event, k: Key) callconv(.c) void {
    if (comptime std.debug.runtime_safety) {
        _ = std.meta.intToEnum(Key, @intFromEnum(k)) catch {
            log.warn("set_key invalid key value={d}", .{@intFromEnum(k)});
            return;
        };
    }

    const event: *KeyEvent = &event_.?.event;
    event.key = k;
}

pub fn get_key(event_: Event) callconv(.c) Key {
    const event: *KeyEvent = &event_.?.event;
    return event.key;
}

pub fn set_mods(event_: Event, mods: KeyMods) callconv(.c) void {
    const event: *KeyEvent = &event_.?.event;
    event.mods = mods;
}

pub fn get_mods(event_: Event) callconv(.c) KeyMods {
    const event: *KeyEvent = &event_.?.event;
    return event.mods;
}

pub fn set_consumed_mods(event_: Event, consumed_mods: KeyMods) callconv(.c) void {
    const event: *KeyEvent = &event_.?.event;
    event.consumed_mods = consumed_mods;
}

pub fn get_consumed_mods(event_: Event) callconv(.c) KeyMods {
    const event: *KeyEvent = &event_.?.event;
    return event.consumed_mods;
}

pub fn set_composing(event_: Event, composing: bool) callconv(.c) void {
    const event: *KeyEvent = &event_.?.event;
    event.composing = composing;
}

pub fn get_composing(event_: Event) callconv(.c) bool {
    const event: *KeyEvent = &event_.?.event;
    return event.composing;
}

pub fn set_utf8(event_: Event, utf8: ?[*]const u8, len: usize) callconv(.c) void {
    const wrapper = event_ orelse return;

    wrapper.utf8_owned.clearRetainingCapacity();

    if (utf8) |ptr| {
        if (len == 0) {
            wrapper.event.utf8 = "";
            return;
        }

        wrapper.utf8_owned.appendSlice(wrapper.alloc, ptr[0..len]) catch {
            wrapper.event.utf8 = "";
            return;
        };
        wrapper.event.utf8 = wrapper.utf8_owned.items;
        return;
    }

    wrapper.event.utf8 = "";
}

/// Returns UTF-8 bytes for the key event.
/// The returned pointer remains valid until the next get_utf8 call for this
/// event wrapper, or until ghostty_key_event_free is called.
pub fn get_utf8(event_: Event, len: ?*usize) callconv(.c) ?[*]const u8 {
    const wrapper = event_ orelse return null;
    const utf8 = wrapper.event.utf8;
    if (len) |l| l.* = utf8.len;
    if (utf8.len == 0) return null;

    // Copy into a dedicated readback buffer so pointer lifetimes are not tied
    // to set_utf8 reallocations.
    wrapper.utf8_readback.clearRetainingCapacity();
    wrapper.utf8_readback.appendSlice(wrapper.alloc, utf8) catch {
        if (len) |l| l.* = 0;
        return null;
    };
    return wrapper.utf8_readback.items.ptr;
}

pub fn set_unshifted_codepoint(event_: Event, codepoint: u32) callconv(.c) void {
    const event: *KeyEvent = &event_.?.event;
    event.unshifted_codepoint = @truncate(codepoint);
}

pub fn get_unshifted_codepoint(event_: Event) callconv(.c) u32 {
    const event: *KeyEvent = &event_.?.event;
    return event.unshifted_codepoint;
}

test "alloc" {
    const testing = std.testing;
    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &lib_alloc.test_allocator,
        &e,
    ));
    free(e);
}

test "set" {
    const testing = std.testing;
    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &lib_alloc.test_allocator,
        &e,
    ));
    defer free(e);

    // Test action
    set_action(e, .press);
    try testing.expectEqual(KeyAction.press, e.?.event.action);

    // Test key
    set_key(e, .key_a);
    try testing.expectEqual(Key.key_a, e.?.event.key);

    // Test mods
    const mods: KeyMods = .{ .shift = true, .ctrl = true };
    set_mods(e, mods);
    try testing.expect(e.?.event.mods.shift);
    try testing.expect(e.?.event.mods.ctrl);

    // Test consumed mods
    const consumed: KeyMods = .{ .shift = true };
    set_consumed_mods(e, consumed);
    try testing.expect(e.?.event.consumed_mods.shift);
    try testing.expect(!e.?.event.consumed_mods.ctrl);

    // Test composing
    set_composing(e, true);
    try testing.expect(e.?.event.composing);

    // Test UTF-8
    const text = "hello";
    set_utf8(e, text.ptr, text.len);
    try testing.expectEqualStrings(text, e.?.event.utf8);

    // Test UTF-8 null
    set_utf8(e, null, 0);
    try testing.expectEqualStrings("", e.?.event.utf8);

    // Test unshifted codepoint
    set_unshifted_codepoint(e, 'a');
    try testing.expectEqual(@as(u21, 'a'), e.?.event.unshifted_codepoint);
}

test "get" {
    const testing = std.testing;
    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &lib_alloc.test_allocator,
        &e,
    ));
    defer free(e);

    // Set some values
    set_action(e, .repeat);
    set_key(e, .key_z);

    const mods: KeyMods = .{ .alt = true, .super = true };
    set_mods(e, mods);

    const consumed: KeyMods = .{ .alt = true };
    set_consumed_mods(e, consumed);

    set_composing(e, true);

    const text = "test";
    set_utf8(e, text.ptr, text.len);

    set_unshifted_codepoint(e, 'z');

    // Get them back
    try testing.expectEqual(KeyAction.repeat, get_action(e));
    try testing.expectEqual(Key.key_z, get_key(e));

    const got_mods = get_mods(e);
    try testing.expect(got_mods.alt);
    try testing.expect(got_mods.super);

    const got_consumed = get_consumed_mods(e);
    try testing.expect(got_consumed.alt);
    try testing.expect(!got_consumed.super);

    try testing.expect(get_composing(e));

    var utf8_len: usize = undefined;
    const got_utf8 = get_utf8(e, &utf8_len);
    try testing.expect(got_utf8 != null);
    try testing.expectEqual(@as(usize, 4), utf8_len);
    try testing.expectEqualStrings("test", got_utf8.?[0..utf8_len]);

    try testing.expectEqual(@as(u32, 'z'), get_unshifted_codepoint(e));
}

test "complete key event" {
    const testing = std.testing;
    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &lib_alloc.test_allocator,
        &e,
    ));
    defer free(e);

    // Build a complete key event for shift+a
    set_action(e, .press);
    set_key(e, .key_a);

    const mods: KeyMods = .{ .shift = true };
    set_mods(e, mods);

    const consumed: KeyMods = .{ .shift = true };
    set_consumed_mods(e, consumed);

    const text = "A";
    set_utf8(e, text.ptr, text.len);

    set_unshifted_codepoint(e, 'a');

    // Verify all fields
    try testing.expectEqual(KeyAction.press, e.?.event.action);
    try testing.expectEqual(Key.key_a, e.?.event.key);
    try testing.expect(e.?.event.mods.shift);
    try testing.expect(e.?.event.consumed_mods.shift);
    try testing.expectEqualStrings("A", e.?.event.utf8);
    try testing.expectEqual(@as(u21, 'a'), e.?.event.unshifted_codepoint);

    // Also test the getter
    var utf8_len: usize = undefined;
    const got_utf8 = get_utf8(e, &utf8_len);
    try testing.expect(got_utf8 != null);
    try testing.expectEqual(@as(usize, 1), utf8_len);
    try testing.expectEqualStrings("A", got_utf8.?[0..utf8_len]);
}

test "set_utf8 copies caller buffer" {
    const testing = std.testing;
    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &lib_alloc.test_allocator,
        &e,
    ));
    defer free(e);

    var input = [_]u8{ 'h', 'i' };
    set_utf8(e, input[0..].ptr, input.len);
    input[0] = 'b';

    try testing.expectEqualStrings("hi", e.?.event.utf8);

    var utf8_len: usize = undefined;
    const got_utf8 = get_utf8(e, &utf8_len);
    try testing.expect(got_utf8 != null);
    try testing.expectEqual(@as(usize, 2), utf8_len);
    try testing.expectEqualStrings("hi", got_utf8.?[0..utf8_len]);
}

test "get_utf8 pointer stays valid across set_utf8 updates" {
    const testing = std.testing;
    var poison = PoisonAllocator{ .inner = std.testing.allocator };

    var e: Event = undefined;
    try testing.expectEqual(Result.success, new(
        &poison.toC(),
        &e,
    ));
    defer free(e);

    const first = "a";
    set_utf8(e, first.ptr, first.len);
    var first_len: usize = undefined;
    const first_ptr = get_utf8(e, &first_len).?;
    try testing.expectEqual(@as(usize, 1), first_len);
    try testing.expectEqualStrings("a", first_ptr[0..first_len]);

    var replacement: [4096]u8 = .{0} ** 4096;
    @memset(&replacement, 'x');
    set_utf8(e, replacement[0..].ptr, replacement.len);

    if (poison.last_freed_ptr) |freed_ptr| {
        try testing.expect(freed_ptr != first_ptr);
    }
    try testing.expectEqualStrings("a", first_ptr[0..first_len]);

    var replacement_len: usize = undefined;
    const replacement_ptr = get_utf8(e, &replacement_len).?;
    try testing.expectEqual(@as(usize, replacement.len), replacement_len);
    try testing.expectEqual(@as(u8, 'x'), replacement_ptr[0]);
}
