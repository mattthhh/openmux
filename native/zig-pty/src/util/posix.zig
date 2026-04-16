//! POSIX and libc compatibility bindings for zig-pty.
//!
//! Zig 0.16 on macOS currently has trouble translating several system headers
//! we used through `@cImport` (`libproc.h`, `notify.h`, `sys/event.h`, etc.).
//! To keep vendor dependencies untouched, we provide a tiny local facade with
//! the libc declarations and numeric constants this project actually uses.

const builtin = @import("builtin");
const std = @import("std");

const CIntBits = std.meta.Int(.unsigned, @bitSizeOf(c_int));

fn oFlag(value: std.c.O) c_int {
    const bits: CIntBits = @bitCast(value);
    return @bitCast(bits);
}

pub const c = struct {
    pub const winsize = std.posix.winsize;
    pub const termios = std.posix.termios;
    pub const pollfd = std.posix.pollfd;
    pub const pid_t = std.posix.pid_t;
    pub const timespec = std.posix.timespec;

    pub const O_RDONLY: c_int = oFlag(.{ .ACCMODE = .RDONLY });
    pub const O_NONBLOCK: c_int = oFlag(.{ .NONBLOCK = true });

    pub const F_GETFL: c_int = std.c.F.GETFL;
    pub const F_SETFL: c_int = std.c.F.SETFL;
    pub const F_SETFD: c_int = std.c.F.SETFD;
    pub const FD_CLOEXEC: c_int = std.c.FD_CLOEXEC;

    pub const POLLIN: i16 = std.c.POLL.IN;
    pub const POLLHUP: i16 = std.c.POLL.HUP;
    pub const POLLERR: i16 = std.c.POLL.ERR;
    pub const POLLNVAL: i16 = std.c.POLL.NVAL;

    pub const SIGTERM: c_int = @intFromEnum(std.c.SIG.TERM);
    pub const SIGKILL: c_int = @intFromEnum(std.c.SIG.KILL);

    pub const EINTR: c_int = @intFromEnum(std.c.E.INTR);
    pub const EAGAIN: c_int = @intFromEnum(std.c.E.AGAIN);
    pub const EWOULDBLOCK: c_int = EAGAIN;
    pub const EPIPE: c_int = @intFromEnum(std.c.E.PIPE);

    pub const WNOHANG: c_int = @intCast(std.posix.W.NOHANG);

    pub const TIOCGWINSZ: usize = if (builtin.os.tag == .macos) 0x40087468 else std.c.T.IOCGWINSZ;
    pub const TIOCSWINSZ: usize = if (builtin.os.tag == .macos) 0x80087467 else std.c.T.IOCSWINSZ;
    pub const TIOCSCTTY: usize = if (builtin.os.tag == .macos) 0x20007461 else std.c.T.IOCSCTTY;

    pub const _errno = std.c._errno;

    pub extern "c" fn close(fd: c_int) c_int;
    pub extern "c" fn ioctl(fd: c_int, request: usize, ...) c_int;
    pub extern "c" fn kill(pid: c_int, sig: c_int) c_int;
    pub extern "c" fn pipe(fds: *[2]c_int) c_int;
    pub extern "c" fn fork() c_int;
    pub extern "c" fn setsid() c_int;
    pub extern "c" fn chdir(path: [*:0]const u8) c_int;
    pub extern "c" fn execve(path: [*:0]const u8, argv: [*:null]const ?[*:0]const u8, envp: [*:null]const ?[*:0]const u8) c_int;
    pub extern "c" fn waitpid(pid: c_int, status: ?*c_int, options: c_int) c_int;
    pub extern "c" fn dup(fd: c_int) c_int;
    pub extern "c" fn dup2(old_fd: c_int, new_fd: c_int) c_int;
    pub extern "c" fn fcntl(fd: c_int, cmd: c_int, ...) c_int;
    pub extern "c" fn getenv(name: [*:0]const u8) ?[*:0]u8;
    pub extern "c" fn open(path: [*:0]const u8, oflag: c_int, ...) c_int;
    pub extern "c" fn _exit(status: c_int) noreturn;
    pub extern "c" fn getpid() c_int;
    pub extern "c" fn openpty(amaster: *c_int, aslave: *c_int, name: ?[*:0]u8, termp: ?*termios, winp: ?*winsize) c_int;
    pub extern "c" fn tcgetpgrp(fd: c_int) c_int;

    pub extern "c" fn _NSGetEnviron() ?*[*:null]?[*:0]u8;
    pub extern "c" fn sysctl(name: [*]const c_int, namelen: c_uint, oldp: ?*anyopaque, oldlenp: ?*usize, newp: ?*const anyopaque, newlen: usize) c_int;
    pub extern "c" fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: ?*anyopaque, buffersize: c_int) c_int;
    pub extern "c" fn proc_listpids(kind: c_uint, typeinfo: c_uint, buffer: ?*anyopaque, buffersize: c_int) c_int;

    pub fn read(fd: c_int, buf: anytype, nbyte: usize) isize {
        return std.c.read(fd, @ptrCast(buf), nbyte);
    }

    pub fn write(fd: c_int, buf: anytype, nbyte: usize) isize {
        return std.c.write(fd, @ptrCast(buf), nbyte);
    }

    pub fn poll(fds: anytype, nfds: usize, timeout: c_int) c_int {
        return std.c.poll(@ptrCast(fds), @intCast(nfds), timeout);
    }

    pub fn readlink(path: [*:0]const u8, buf: anytype, bufsize: usize) isize {
        return std.c.readlink(path, @ptrCast(buf), bufsize);
    }

    pub fn WIFEXITED(status: c_int) bool {
        if (builtin.os.tag == .linux) {
            return std.posix.W.IFEXITED(@bitCast(@as(u32, @intCast(status))));
        }
        return (status & 0x7f) == 0;
    }

    pub fn WEXITSTATUS(status: c_int) c_int {
        if (builtin.os.tag == .linux) {
            return @intCast(std.posix.W.EXITSTATUS(@bitCast(@as(u32, @intCast(status)))));
        }
        return (status >> 8) & 0xff;
    }

    pub fn WIFSIGNALED(status: c_int) bool {
        if (builtin.os.tag == .linux) {
            return std.posix.W.IFSIGNALED(@bitCast(@as(u32, @intCast(status))));
        }
        const wstatus = status & 0x7f;
        return wstatus != 0 and wstatus != 0x7f;
    }

    pub fn WTERMSIG(status: c_int) c_int {
        if (builtin.os.tag == .linux) {
            return @intCast(@intFromEnum(std.posix.W.TERMSIG(@bitCast(@as(u32, @intCast(status))))));
        }
        return status & 0x7f;
    }
};

/// Get environ - platform specific.
pub fn getEnviron() ?[*:null]?[*:0]u8 {
    if (builtin.os.tag == .macos) {
        const environ_ptr = c._NSGetEnviron();
        if (environ_ptr) |ptr| {
            return ptr.*;
        }
        return null;
    }
    return std.c.environ;
}
