//! Process Information Module
//! Native APIs for process inspection without subprocess spawning.
//!
//! Provides:
//! - Process name detection (argv basename with runtime-aware argv[1] fallback)
//! - Current working directory lookup
//! - Child process finding for foreground detection
//!
//! Platform support:
//! - macOS: Uses libproc (proc_pidinfo, proc_listpids) and sysctl (KERN_PROCARGS2)
//! - Linux: Uses /proc filesystem

const std = @import("std");
const builtin = @import("builtin");
const constants = @import("../util/constants.zig");
const posix = @import("../util/posix.zig");
const c = posix.c;

// ============================================================================
// Public API
// ============================================================================

/// Get the name of a process, preferring argv basename over executable name.
/// This gives better results for CLI tools (e.g., "claude" instead of "node").
///
/// Returns: number of bytes written to buf (> 0), or ERROR (-1) on failure.
pub fn getProcessName(pid: c_int, buf: [*]u8, len: usize) c_int {
    if (pid <= 0 or len == 0) return constants.ERROR;

    if (builtin.os.tag == .macos) {
        return macos.getProcessName(pid, buf, len);
    } else if (builtin.os.tag == .linux) {
        return linux.getProcessName(pid, buf, len);
    }

    return constants.ERROR;
}

/// Get the current working directory of a process.
///
/// Returns: number of bytes written to buf (> 0), or ERROR (-1) on failure.
pub fn getProcessCwd(pid: c_int, buf: [*]u8, len: usize) c_int {
    if (pid <= 0 or len == 0) return constants.ERROR;

    if (builtin.os.tag == .macos) {
        return macos.getProcessCwd(pid, buf, len);
    } else if (builtin.os.tag == .linux) {
        return linux.getProcessCwd(pid, buf, len);
    }

    return constants.ERROR;
}

/// Find the deepest descendant process of a parent.
/// Traverses the full descendant chain (not just direct children) to handle
/// nested shells, e.g. macOS login shell → interactive shell → app like mole.
///
/// Returns: deepest descendant PID if found, or parent_pid if no descendants.
pub fn findDeepestDescendant(parent_pid: c_int) c_int {
    if (parent_pid <= 0) return parent_pid;

    if (builtin.os.tag == .macos) {
        return macos.findDeepestDescendant(parent_pid);
    } else if (builtin.os.tag == .linux) {
        return linux.findDeepestDescendant(parent_pid);
    }

    return parent_pid;
}

fn copyNameToBuf(name: []const u8, buf: [*]u8, len: usize) c_int {
    if (len == 0 or name.len == 0) return constants.ERROR;

    const copy_len = @min(name.len, len - 1);
    @memcpy(buf[0..copy_len], name[0..copy_len]);
    buf[copy_len] = 0;

    return @intCast(copy_len);
}

fn basename(path: []const u8) []const u8 {
    var start: usize = 0;
    for (path, 0..) |ch, i| {
        if (ch == '/') {
            start = i + 1;
        }
    }
    return path[start..];
}

fn stripScriptExtension(name: []const u8) []const u8 {
    if (std.mem.endsWith(u8, name, ".js")) return name[0 .. name.len - 3];
    if (std.mem.endsWith(u8, name, ".mjs")) return name[0 .. name.len - 4];
    if (std.mem.endsWith(u8, name, ".cjs")) return name[0 .. name.len - 4];
    return name;
}

fn isRuntimeName(name: []const u8) bool {
    return std.mem.eql(u8, name, "node") or
        std.mem.eql(u8, name, "nodejs") or
        std.mem.eql(u8, name, "bun") or
        std.mem.eql(u8, name, "deno");
}

fn pickArgvBasename(argv0: []const u8, argv1: []const u8) []const u8 {
    const argv0_base = basename(argv0);
    if (!isRuntimeName(argv0_base)) return argv0_base;

    if (argv1.len == 0 or argv1[0] == '-') return argv0_base;

    const argv1_base = basename(argv1);
    const stripped = stripScriptExtension(argv1_base);
    if (stripped.len == 0) return argv0_base;

    if ((std.mem.eql(u8, stripped, "cli") or std.mem.eql(u8, stripped, "index")) and
        std.mem.find(u8, argv1, "codex") != null)
    {
        return "codex";
    }

    return stripped;
}

// ============================================================================
// macOS Implementation
// ============================================================================

const macos = struct {
    // Struct layout constants (verified via offsetof() in C)
    const PROC_PIDTBSDINFO = 3;
    const PROC_PIDTBSDINFO_SIZE = 136;
    const PROC_PIDVNODEPATHINFO = 9;
    const PROC_PIDVNODEPATHINFO_SIZE = 2352;

    // Offsets within struct proc_bsdinfo
    const PPID_OFFSET = 16; // offsetof(struct proc_bsdinfo, pbi_ppid)
    const COMM_OFFSET = 48; // offsetof(struct proc_bsdinfo, pbi_comm)
    const MAXCOMLEN = 16;

    // Offsets within struct proc_vnodepathinfo
    const VIP_PATH_OFFSET = 152; // offset of vip_path (cwd)
    const MAXPATHLEN = 1024;

    // sysctl constants
    const CTL_KERN = 1;
    const KERN_ARGMAX = 8;
    const KERN_PROCARGS2 = 49;

    /// Get process name, preferring argv basename over pbi_comm.
    /// Falls back to pbi_comm if argv info is unavailable.
    pub fn getProcessName(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .macos) return constants.ERROR;

        // First try to get argv info via sysctl - this gives better names for CLI tools
        const argv_result = getArgvBasename(pid, buf, len);
        if (argv_result > 0) {
            return argv_result;
        }

        // Fall back to pbi_comm from proc_pidinfo
        return getCommName(pid, buf, len);
    }

    /// Get preferred argv basename via sysctl KERN_PROCARGS2.
    /// Returns: length written, or <= 0 on failure.
    fn getArgvBasename(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .macos) return constants.ERROR;

        // Get KERN_ARGMAX to know buffer size needed
        var argmax: c_int = 0;
        var argmax_size: usize = @sizeOf(c_int);
        var mib = [_]c_int{ CTL_KERN, KERN_ARGMAX };

        if (c.sysctl(@ptrCast(&mib), 2, @ptrCast(&argmax), &argmax_size, null, 0) != 0) {
            return constants.ERROR;
        }

        if (argmax <= 0 or argmax > 1024 * 1024) {
            return constants.ERROR; // Sanity check
        }

        // Use stack buffer for small sizes, but cap to prevent stack overflow
        const safe_argmax: usize = @min(@as(usize, @intCast(argmax)), 65536);
        var procargs_buf: [65536]u8 = undefined;
        var size: usize = safe_argmax;

        var mib2 = [_]c_int{ CTL_KERN, KERN_PROCARGS2, pid };
        if (c.sysctl(@ptrCast(&mib2), 3, @ptrCast(&procargs_buf), &size, null, 0) != 0) {
            return constants.ERROR;
        }

        if (size < @sizeOf(c_int) + 2) {
            return constants.ERROR; // Not enough data
        }

        // Parse: first comes argc (int), then exec_path, then argv[0], ...
        const nargs_ptr: *align(1) const c_int = @ptrCast(&procargs_buf[0]);
        _ = nargs_ptr.*; // We don't actually need nargs, just skip past it

        var p: usize = @sizeOf(c_int);

        // Skip executable path (null-terminated string)
        while (p < size and procargs_buf[p] != 0) : (p += 1) {}
        // Skip null padding
        while (p < size and procargs_buf[p] == 0) : (p += 1) {}

        if (p >= size) {
            return constants.ERROR;
        }

        // Now at argv[0]
        const argv0_start = p;
        while (p < size and procargs_buf[p] != 0) : (p += 1) {}
        const argv0_end = p;

        if (argv0_end <= argv0_start) {
            return constants.ERROR;
        }

        var argv1_start: usize = 0;
        var argv1_end: usize = 0;

        // Move to argv[1] if present
        while (p < size and procargs_buf[p] == 0) : (p += 1) {}
        if (p < size) {
            argv1_start = p;
            while (p < size and procargs_buf[p] != 0) : (p += 1) {}
            argv1_end = p;
        }

        const argv0 = procargs_buf[argv0_start..argv0_end];
        const argv1 = if (argv1_end > argv1_start) procargs_buf[argv1_start..argv1_end] else "";
        const preferred = pickArgvBasename(argv0, argv1);

        return copyNameToBuf(preferred, buf, len);
    }

    /// Get pbi_comm from proc_bsdinfo (fallback method).
    fn getCommName(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .macos) return constants.ERROR;

        var info: [PROC_PIDTBSDINFO_SIZE]u8 = undefined;
        const result = c.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, @ptrCast(&info), PROC_PIDTBSDINFO_SIZE);

        if (result <= 0) {
            return constants.ERROR;
        }

        const comm_ptr: [*]const u8 = @ptrCast(&info[COMM_OFFSET]);

        var name_len: usize = 0;
        while (name_len < MAXCOMLEN and comm_ptr[name_len] != 0) : (name_len += 1) {}

        if (name_len == 0) {
            return constants.ERROR;
        }

        return copyNameToBuf(comm_ptr[0..name_len], buf, len);
    }

    /// Get current working directory via proc_pidinfo.
    pub fn getProcessCwd(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .macos) return constants.ERROR;

        var info: [PROC_PIDVNODEPATHINFO_SIZE]u8 = undefined;
        const result = c.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, @ptrCast(&info), PROC_PIDVNODEPATHINFO_SIZE);

        if (result <= 0) {
            return constants.ERROR;
        }

        const path_ptr: [*]const u8 = @ptrCast(&info[VIP_PATH_OFFSET]);

        var path_len: usize = 0;
        while (path_len < MAXPATHLEN and path_ptr[path_len] != 0) : (path_len += 1) {}

        if (path_len == 0) {
            return constants.ERROR;
        }

        const copy_len = @min(path_len, len - 1);
        @memcpy(buf[0..copy_len], path_ptr[0..copy_len]);
        buf[copy_len] = 0;

        return @intCast(copy_len);
    }

    /// Find the deepest descendant process of a parent PID.
    /// Builds a full PPID → PID map from the process list, then walks
    /// down the descendant chain choosing the highest-PID child at each
    /// level until no further descendants exist.
    pub fn findDeepestDescendant(root_pid: c_int) c_int {
        if (builtin.os.tag != .macos) return root_pid;

        // Get count of all PIDs
        const bytes_needed = c.proc_listpids(1, 0, null, 0); // PROC_ALL_PIDS = 1
        if (bytes_needed <= 0) return root_pid;

        const pid_count: usize = @intCast(@divTrunc(bytes_needed, 4));
        if (pid_count == 0) return root_pid;

        const max_pids: usize = @min(pid_count + 100, 10000);
        var pid_buf: [10000 * 4]u8 = undefined;

        const actual_bytes = c.proc_listpids(1, 0, @ptrCast(&pid_buf), @intCast(max_pids * 4));
        if (actual_bytes <= 0) return root_pid;

        const actual_count: usize = @intCast(@divTrunc(actual_bytes, 4));

        // Build PPID → children map (stack-allocated, bounded)
        // Each parent can have up to 8 children tracked; good enough for
        // terminal process trees which are typically linear.
        const MAX_CHILDREN = 8;
        const ParentEntry = struct { count: usize, pids: [MAX_CHILDREN]c_int };
        var parent_map: [512]struct { ppid: c_int, entry: ParentEntry } = undefined;
        var parent_count: usize = 0;
        var info: [PROC_PIDTBSDINFO_SIZE]u8 = undefined;

        for (0..actual_count) |i| {
            const pid_ptr: *align(1) const c_int = @ptrCast(&pid_buf[i * 4]);
            const pid = pid_ptr.*;
            if (pid <= 0) continue;

            const result = c.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, @ptrCast(&info), PROC_PIDTBSDINFO_SIZE);
            if (result <= 0) continue;

            const ppid_ptr: *align(1) const u32 = @ptrCast(&info[PPID_OFFSET]);
            const ppid: c_int = @intCast(ppid_ptr.*);
            if (ppid <= 0) continue;

            // Find or create entry for this ppid
            var found: ?usize = null;
            for (0..parent_count) |j| {
                if (parent_map[j].ppid == ppid) {
                    found = j;
                    break;
                }
            }

            if (found) |j| {
                var entry = &parent_map[j].entry;
                if (entry.count < MAX_CHILDREN) {
                    entry.pids[entry.count] = pid;
                    entry.count += 1;
                }
            } else if (parent_count < parent_map.len) {
                var entry = ParentEntry{ .count = 1, .pids = undefined };
                entry.pids[0] = pid;
                parent_map[parent_count] = .{ .ppid = ppid, .entry = entry };
                parent_count += 1;
            }
        }

        // Walk down the descendant chain from root_pid, choosing the
        // highest-PID child at each level (most recently spawned).
        var current = root_pid;
        var visited: [32]c_int = undefined;
        var visited_count: usize = 0;

        while (true) {
            // Cycle guard
            for (0..visited_count) |j| {
                if (visited[j] == current) return current;
            }
            if (visited_count >= visited.len) return current;
            visited[visited_count] = current;
            visited_count += 1;

            // Find children of current
            var best_child: c_int = 0;
            for (0..parent_count) |j| {
                if (parent_map[j].ppid != current) continue;
                const entry = parent_map[j].entry;
                for (0..entry.count) |k| {
                    if (entry.pids[k] > best_child) best_child = entry.pids[k];
                }
                break;
            }

            if (best_child == 0) return current;
            current = best_child;
        }
    }
};

// ============================================================================
// Linux Implementation
// ============================================================================

const linux = struct {
    /// Get process name from /proc/<pid>/cmdline, falling back to /proc/<pid>/comm.
    /// Prefers argv basename for better CLI tool names.
    pub fn getProcessName(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .linux) return constants.ERROR;

        // First try /proc/<pid>/cmdline for argv[0]
        const cmdline_result = getCmdlineBasename(pid, buf, len);
        if (cmdline_result > 0) {
            return cmdline_result;
        }

        // Fall back to /proc/<pid>/comm
        return getCommName(pid, buf, len);
    }

    /// Get argv[0] basename from /proc/<pid>/cmdline.
    fn getCmdlineBasename(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .linux) return constants.ERROR;

        var path_buf: [32]u8 = undefined;
        const path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/cmdline", .{pid}) catch return constants.ERROR;

        const fd = c.open(path, c.O_RDONLY);
        if (fd < 0) return constants.ERROR;
        defer _ = c.close(fd);

        var cmdline: [4096]u8 = undefined;
        const bytes_read = c.read(fd, &cmdline, cmdline.len - 1);
        if (bytes_read <= 0) return constants.ERROR;

        const total_len: usize = @intCast(bytes_read);

        // argv[0] is the first null-terminated string
        var argv0_len: usize = 0;
        while (argv0_len < total_len and cmdline[argv0_len] != 0) : (argv0_len += 1) {}

        if (argv0_len == 0) return constants.ERROR;

        var argv1_start: usize = 0;
        var argv1_end: usize = 0;

        var next_index = argv0_len;
        while (next_index < total_len and cmdline[next_index] == 0) : (next_index += 1) {}
        if (next_index < total_len) {
            argv1_start = next_index;
            while (next_index < total_len and cmdline[next_index] != 0) : (next_index += 1) {}
            argv1_end = next_index;
        }

        const argv0 = cmdline[0..argv0_len];
        const argv1 = if (argv1_end > argv1_start) cmdline[argv1_start..argv1_end] else "";
        const preferred = pickArgvBasename(argv0, argv1);

        return copyNameToBuf(preferred, buf, len);
    }

    /// Get process name from /proc/<pid>/comm (fallback).
    fn getCommName(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .linux) return constants.ERROR;

        var path_buf: [32]u8 = undefined;
        const path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/comm", .{pid}) catch return constants.ERROR;

        const fd = c.open(path, c.O_RDONLY);
        if (fd < 0) return constants.ERROR;
        defer _ = c.close(fd);

        const bytes_read = c.read(fd, buf, len - 1);
        if (bytes_read <= 0) return constants.ERROR;

        // Remove trailing newline
        var actual_len: usize = @intCast(bytes_read);
        if (actual_len > 0 and buf[actual_len - 1] == '\n') {
            actual_len -= 1;
        }
        buf[actual_len] = 0;

        return @intCast(actual_len);
    }

    /// Get current working directory from /proc/<pid>/cwd.
    pub fn getProcessCwd(pid: c_int, buf: [*]u8, len: usize) c_int {
        if (builtin.os.tag != .linux) return constants.ERROR;

        var path_buf: [32]u8 = undefined;
        const path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/cwd", .{pid}) catch return constants.ERROR;

        const result = c.readlink(path, buf, len - 1);
        if (result < 0) return constants.ERROR;

        buf[@intCast(result)] = 0;
        return @intCast(result);
    }

    /// Find the deepest descendant process from /proc/<pid>/task/<pid>/children.
    /// Recursively follows the children chain to reach the leaf process.
    pub fn findDeepestDescendant(root_pid: c_int) c_int {
        if (builtin.os.tag != .linux) return root_pid;

        var current = root_pid;
        var visited: [32]c_int = undefined;
        var visited_count: usize = 0;

        while (true) {
            // Cycle guard
            for (0..visited_count) |j| {
                if (visited[j] == current) return current;
            }
            if (visited_count >= visited.len) return current;
            visited[visited_count] = current;
            visited_count += 1;

            // Read children of current PID
            var path_buf: [64]u8 = undefined;
            const path = std.fmt.bufPrintZ(&path_buf, "/proc/{d}/task/{d}/children", .{ current, current }) catch return current;

            const fd = c.open(path, c.O_RDONLY);
            if (fd < 0) return current;
            defer _ = c.close(fd);

            var children_buf: [256]u8 = undefined;
            const bytes_read = c.read(fd, &children_buf, children_buf.len - 1);
            if (bytes_read <= 0) return current;

            // Parse space-separated PIDs, pick highest (most recent)
            var best_child: c_int = 0;
            var iter = std.mem.tokenizeScalar(u8, children_buf[0..@intCast(bytes_read)], ' ');
            while (iter.next()) |token| {
                const pid = std.fmt.parseInt(c_int, token, 10) catch continue;
                if (pid > best_child) best_child = pid;
            }

            if (best_child == 0) return current;
            current = best_child;
        }
    }
};

test "pickArgvBasename prefers argv1 for runtime" {
    const chosen = pickArgvBasename("node", "/usr/local/bin/codex");
    try std.testing.expectEqualStrings("codex", chosen);
}

test "pickArgvBasename maps cli.js with codex path to codex" {
    const chosen = pickArgvBasename("node", "/opt/codex/cli.js");
    try std.testing.expectEqualStrings("codex", chosen);
}

test "pickArgvBasename keeps argv0 for non-runtime" {
    const chosen = pickArgvBasename("/bin/zsh", "/usr/local/bin/anything");
    try std.testing.expectEqualStrings("zsh", chosen);
}
