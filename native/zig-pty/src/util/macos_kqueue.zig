//! macOS kqueue/kevent and notify(3) bindings
//!
//! We avoid using translate-c for these because <sys/event.h> and <notify.h>
//! transitively include Mach headers that produce opaque types Zig can't handle.
//! Instead, we use Zig's std.c types (Kevent, EVFILT) and manual extern decls.

const builtin = @import("builtin");
const std = @import("std");

/// kqueue/kevent constants available via std.c on Darwin
pub const EVFILT_PROC = std.c.EVFILT.PROC;
pub const EV_ADD: u16 = 0x0001;
pub const EV_ENABLE: u16 = 0x0004;
pub const EV_ONESHOT: u16 = 0x0010;
pub const NOTE_EXIT: u32 = 0x80000000;
pub const NOTE_EXITSTATUS: u32 = 0x04000000;

pub const Kevent = std.posix.Kevent;

extern fn kqueue() c_int;
extern fn kevent(kq: c_int, changelist: ?*const Kevent, nchanges: c_int, eventlist: ?*Kevent, nevents: c_int, timeout: ?*const std.posix.timespec) c_int;

pub fn createKqueue() c_int {
    return kqueue();
}

pub fn registerExitWatch(kq: c_int, pid: c_int) c_int {
    const change = Kevent{
        .ident = @intCast(pid),
        .filter = EVFILT_PROC,
        .flags = EV_ADD | EV_ENABLE | EV_ONESHOT,
        .fflags = NOTE_EXIT | NOTE_EXITSTATUS,
        .data = 0,
        .udata = 0,
    };
    if (kevent(kq, &change, 1, null, 0, null) == -1) {
        return -1;
    }
    return 0;
}

pub fn checkExitEvent(kq: c_int) ?Kevent {
    var event: Kevent = undefined;
    var ts: std.posix.timespec = .{ .sec = 0, .nsec = 0 };
    const n = kevent(kq, null, 0, &event, 1, &ts);
    if (n == 1) return event;
    return null;
}

// notify(3) bindings - manual extern declarations
extern fn notify_register_file_descriptor(name: [*:0]const u8, fd: *c_int, flags: c_int, token: *c_int) c_int;
extern fn notify_cancel(token: c_int) c_int;
extern fn notify_register_signal(name: [*:0]const u8, sig: c_int, token: *c_int) c_int;

pub fn notifyRegisterFileDescriptor(name: [*:0]const u8, fd: *c_int, flags: c_int, token: *c_int) c_int {
    return notify_register_file_descriptor(name, fd, flags, token);
}

pub fn notifyCancel(token: c_int) c_int {
    return notify_cancel(token);
}

pub fn notifyRegisterSignal(name: [*:0]const u8, sig: c_int, token: *c_int) c_int {
    return notify_register_signal(name, sig, token);
}
