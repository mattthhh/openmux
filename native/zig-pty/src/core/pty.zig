//! PTY Handle with Background Reader

const std = @import("std");
const builtin = @import("builtin");
const RingBuffer = @import("ring_buffer.zig").RingBuffer;
const posix = @import("../util/posix.zig");
const c = posix.c;
const constants = @import("../util/constants.zig");
const winsize = @import("../util/winsize.zig");

pub const Pty = struct {
    master_fd: c_int,
    wake_read_fd: c_int,
    wake_write_fd: c_int,
    proc_exit_fd: c_int,
    pid: c_int,
    cols: u16,
    rows: u16,
    pixel_width: u16,
    pixel_height: u16,
    exited: std.atomic.Value(bool),
    exit_detected: std.atomic.Value(bool),
    exit_code: std.atomic.Value(c_int),
    stopping: std.atomic.Value(bool),
    ring: RingBuffer,
    reader_thread: ?std.Thread,
    // Foreground process change tracking
    last_foreground_pid: std.atomic.Value(c_int),
    foreground_change_count: std.atomic.Value(u32),

    pub fn initInPlace(
        self: *Pty,
        master_fd: c_int,
        pid: c_int,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
        wake_read_fd: c_int,
        wake_write_fd: c_int,
        proc_exit_fd: c_int,
    ) void {
        self.* = std.mem.zeroes(Pty);
        self.master_fd = master_fd;
        self.wake_read_fd = wake_read_fd;
        self.wake_write_fd = wake_write_fd;
        self.proc_exit_fd = proc_exit_fd;
        self.pid = pid;
        self.cols = cols;
        self.rows = rows;
        self.pixel_width = pixel_width;
        self.pixel_height = pixel_height;
        self.exited = std.atomic.Value(bool).init(false);
        self.exit_detected = std.atomic.Value(bool).init(false);
        self.exit_code = std.atomic.Value(c_int).init(-1);
        self.stopping = std.atomic.Value(bool).init(false);
        self.last_foreground_pid = std.atomic.Value(c_int).init(0);
        self.foreground_change_count = std.atomic.Value(u32).init(0);
        self.ring.initInPlace();
        self.reader_thread = null;
    }

    pub fn init(
        master_fd: c_int,
        pid: c_int,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
        wake_read_fd: c_int,
        wake_write_fd: c_int,
        proc_exit_fd: c_int,
    ) Pty {
        var pty: Pty = undefined;
        pty.initInPlace(
            master_fd,
            pid,
            cols,
            rows,
            pixel_width,
            pixel_height,
            wake_read_fd,
            wake_write_fd,
            proc_exit_fd,
        );
        return pty;
    }

    pub fn startReader(self: *Pty) bool {
        self.reader_thread = std.Thread.spawn(.{}, readerLoop, .{self}) catch return false;
        return true;
    }

    fn signalWakeup(self: *Pty) void {
        if (self.wake_write_fd < 0) return;

        var byte: [1]u8 = .{1};
        while (true) {
            const n = c.write(self.wake_write_fd, &byte, byte.len);
            if (n == 1) return;
            if (n == -1) {
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                if (err == c.EAGAIN or err == c.EWOULDBLOCK or err == c.EPIPE) return;
            }
            return;
        }
    }

    fn hasProcExitWatcher(self: *Pty) bool {
        return self.proc_exit_fd >= 0;
    }

    fn markExitDetected(self: *Pty) void {
        if (self.exit_detected.load(.acquire)) return;
        self.exit_detected.store(true, .release);
        self.signalWakeup();
    }

    fn checkExitEventNonBlocking(self: *Pty) void {
        if (!self.hasProcExitWatcher()) return;
        if (self.exit_detected.load(.acquire)) return;

        if (builtin.os.tag == .macos) {
            var event: c.struct_kevent = undefined;
            var timeout = c.timespec{ .tv_sec = 0, .tv_nsec = 0 };
            const n = c.kevent(self.proc_exit_fd, null, 0, &event, 1, &timeout);
            if (n == 1 and event.filter == c.EVFILT_PROC and (event.fflags & c.NOTE_EXIT) != 0) {
                self.markExitDetected();
            }
            return;
        }

        if (builtin.os.tag == .linux) {
            var pfd = [_]c.pollfd{.{
                .fd = self.proc_exit_fd,
                .events = c.POLLIN,
                .revents = 0,
            }};
            const ready = c.poll(&pfd, 1, 0);
            if (ready > 0 and (pfd[0].revents & (c.POLLIN | c.POLLHUP | c.POLLERR | c.POLLNVAL)) != 0) {
                self.markExitDetected();
            }
        }
    }

    fn readerLoop(self: *Pty) void {
        var buf: [32768]u8 = undefined; // 32KB read buffer

        while (!self.stopping.load(.acquire)) {
            var pfd = [_]c.pollfd{.{
                .fd = self.master_fd,
                .events = c.POLLIN,
                .revents = 0,
            }};

            const poll_result = c.poll(&pfd, 1, 100);
            self.checkExitEventNonBlocking();

            if (poll_result < 0) {
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                break;
            }

            if (poll_result == 0) {
                // Poll timeout - check foreground process change
                if (self.checkForegroundProcessChange()) {
                    self.signalWakeup();
                }

                if (self.hasProcExitWatcher()) {
                    if (self.exit_detected.load(.acquire)) break;
                    continue;
                }

                self.checkChild();
                if (self.exited.load(.acquire)) {
                    self.signalWakeup();
                    break;
                }
                continue;
            }

            const master_revents = pfd[0].revents;
            const master_has_hangup = (master_revents & (c.POLLHUP | c.POLLERR | c.POLLNVAL)) != 0;

            if ((master_revents & c.POLLIN) == 0) {
                if (self.hasProcExitWatcher()) {
                    if (self.exit_detected.load(.acquire) and master_has_hangup) break;
                    if (master_has_hangup) {
                        std.Thread.sleep(1 * std.time.ns_per_ms);
                    }
                    continue;
                }

                if (master_has_hangup) {
                    self.checkChild();
                    if (self.exited.load(.acquire)) {
                        self.signalWakeup();
                        break;
                    }
                }
                continue;
            }

            const n = c.read(self.master_fd, &buf, buf.len);

            if (n > 0) {
                var written: usize = 0;
                while (written < @as(usize, @intCast(n))) {
                    const w = self.ring.write(buf[written..@intCast(n)]);
                    if (w == 0) {
                        self.ring.mutex.lock();
                        while (self.ring.availableSpace() == 0 and !self.stopping.load(.acquire)) {
                            self.ring.not_full.timedWait(&self.ring.mutex, 100 * std.time.ns_per_ms) catch {};
                        }
                        self.ring.mutex.unlock();
                        if (self.stopping.load(.acquire)) break;
                    } else {
                        written += w;
                        self.signalWakeup();
                    }
                }
                continue;
            }

            if (n == 0) {
                if (self.hasProcExitWatcher()) {
                    if (self.exit_detected.load(.acquire)) {
                        self.signalWakeup();
                        break;
                    }
                    std.Thread.sleep(1 * std.time.ns_per_ms);
                    continue;
                }

                self.checkChild();
                if (self.exited.load(.acquire)) {
                    self.signalWakeup();
                }
                break;
            }

            const err = std.c._errno().*;
            if (err == c.EINTR) continue;
            if (err == c.EAGAIN or err == c.EWOULDBLOCK) {
                self.checkExitEventNonBlocking();
                if (self.hasProcExitWatcher()) {
                    if (self.exit_detected.load(.acquire) and master_has_hangup) {
                        self.signalWakeup();
                        break;
                    }
                    continue;
                }

                self.checkChild();
                if (self.exited.load(.acquire)) {
                    self.signalWakeup();
                    break;
                }
                continue;
            }
            break;
        }

        self.checkExitEventNonBlocking();
        if (self.hasProcExitWatcher()) {
            if (self.exit_detected.load(.acquire)) {
                self.signalWakeup();
            }
            return;
        }

        self.checkChild();
        if (self.exited.load(.acquire)) {
            self.signalWakeup();
        }
    }

    pub fn checkChild(self: *Pty) void {
        if (self.exited.load(.acquire)) return;

        var status: c_int = 0;
        const result = c.waitpid(self.pid, &status, c.WNOHANG);

        if (result == self.pid) {
            if (c.WIFEXITED(status)) {
                self.exit_code.store(c.WEXITSTATUS(status), .release);
            } else if (c.WIFSIGNALED(status)) {
                self.exit_code.store(128 + c.WTERMSIG(status), .release);
            }
            self.exited.store(true, .release);
            self.exit_detected.store(true, .release);
        } else if (result == -1) {
            self.exit_code.store(-1, .release);
            self.exited.store(true, .release);
            self.exit_detected.store(true, .release);
        }
    }

    /// Check if foreground process has changed and update tracking.
    /// Returns: true if the foreground process changed since last check.
    pub fn checkForegroundProcessChange(self: *Pty) bool {
        if (self.exited.load(.acquire)) return false;

        const current_fg = c.tcgetpgrp(self.master_fd);
        if (current_fg < 0) return false;

        const last_fg = self.last_foreground_pid.load(.acquire);
        
        // First time checking - just store and return false (no "change" yet)
        if (last_fg == 0) {
            self.last_foreground_pid.store(current_fg, .release);
            return false;
        }

        // No change
        if (current_fg == last_fg) {
            return false;
        }

        // Foreground process changed!
        self.last_foreground_pid.store(current_fg, .release);
        _ = self.foreground_change_count.fetchAdd(1, .acq_rel);
        return true;
    }

    pub fn duplicateWakeReadFd(self: *Pty) c_int {
        if (self.wake_read_fd < 0) return constants.ERROR;

        const dup_fd = c.dup(self.wake_read_fd);
        if (dup_fd < 0) {
            return constants.ERROR;
        }

        _ = c.fcntl(dup_fd, c.F_SETFD, c.FD_CLOEXEC);
        return dup_fd;
    }

    pub fn readAvailable(self: *Pty, buf: [*]u8, len: usize) c_int {
        const n = self.ring.read(buf[0..len]);

        if (n > 0) {
            self.ring.not_full.signal();
            return @intCast(n);
        }

        if (self.ring.available() == 0) {
            if (self.exit_detected.load(.acquire) or !self.hasProcExitWatcher()) {
                self.checkChild();
                if (self.exited.load(.acquire)) {
                    return constants.CHILD_EXITED;
                }
            }
        }

        return 0;
    }

    pub fn writeData(self: *Pty, data: [*]const u8, len: usize) c_int {
        if (self.exited.load(.acquire)) {
            return constants.CHILD_EXITED;
        }

        var written: usize = 0;
        while (written < len) {
            const n = c.write(self.master_fd, data + written, len - written);
            if (n > 0) {
                written += @intCast(n);
            } else if (n == -1) {
                const err = std.c._errno().*;
                if (err == c.EINTR) continue;
                if (err == c.EAGAIN or err == c.EWOULDBLOCK) {
                    std.Thread.sleep(1 * std.time.ns_per_ms);
                    continue;
                }
                return constants.ERROR;
            } else {
                break;
            }
        }

        return if (written == len) constants.SUCCESS else constants.ERROR;
    }

    pub fn resize(self: *Pty, cols: u16, rows: u16) c_int {
        const ws: c.winsize = winsize.makeWinsize(cols, rows);
        self.cols = cols;
        self.rows = rows;
        self.pixel_width = ws.ws_xpixel;
        self.pixel_height = ws.ws_ypixel;

        if (c.ioctl(self.master_fd, c.TIOCSWINSZ, &ws) == -1) {
            return constants.ERROR;
        }

        return constants.SUCCESS;
    }

    pub fn resizeWithPixels(
        self: *Pty,
        cols: u16,
        rows: u16,
        pixel_width: u32,
        pixel_height: u32,
    ) c_int {
        const ws: c.winsize = winsize.makeWinsizeWithPixels(cols, rows, pixel_width, pixel_height);
        self.cols = cols;
        self.rows = rows;
        self.pixel_width = ws.ws_xpixel;
        self.pixel_height = ws.ws_ypixel;

        if (c.ioctl(self.master_fd, c.TIOCSWINSZ, &ws) == -1) {
            return constants.ERROR;
        }

        return constants.SUCCESS;
    }

    pub fn kill(self: *Pty) c_int {
        if (self.pid > 0) {
            _ = c.kill(self.pid, c.SIGTERM);
        }
        return constants.SUCCESS;
    }

    pub fn deinit(self: *Pty) void {
        self.stopping.store(true, .release);
        self.ring.not_full.signal();

        if (self.reader_thread) |thread| {
            thread.join();
            self.reader_thread = null;
        }

        if (self.master_fd >= 0) {
            _ = c.close(self.master_fd);
            self.master_fd = -1;
        }

        if (self.proc_exit_fd >= 0) {
            _ = c.close(self.proc_exit_fd);
            self.proc_exit_fd = -1;
        }

        if (self.wake_write_fd >= 0) {
            _ = c.close(self.wake_write_fd);
            self.wake_write_fd = -1;
        }

        if (self.wake_read_fd >= 0) {
            _ = c.close(self.wake_read_fd);
            self.wake_read_fd = -1;
        }

        if (self.pid > 0 and !self.exited.load(.acquire)) {
            const result = c.waitpid(self.pid, null, c.WNOHANG);
            if (result == 0) {
                const pid = self.pid;
                const reaper = std.Thread.spawn(.{}, reapZombie, .{pid}) catch null;
                if (reaper) |t| t.detach();
            }
        }
    }
};

fn reapZombie(pid: c.pid_t) void {
    _ = c.waitpid(pid, null, 0);
}
