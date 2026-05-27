const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");
const git_mutex = @import("git_mutex.zig");
const git_io = @import("io.zig");

pub const DiffState = enum(u8) {
    pending,
    complete,
    failed,
    cancelled,
};

pub const DiffRequest = struct {
    cwd: [constants.MAX_CWD_LEN]u8,
    cwd_len: usize,
    state: std.atomic.Value(DiffState),
    added: std.atomic.Value(c_int),
    removed: std.atomic.Value(c_int),
    binary: std.atomic.Value(c_int),

    pub fn init() DiffRequest {
        return .{
            .cwd = undefined,
            .cwd_len = 0,
            .state = std.atomic.Value(DiffState).init(.failed),
            .added = std.atomic.Value(c_int).init(0),
            .removed = std.atomic.Value(c_int).init(0),
            .binary = std.atomic.Value(c_int).init(0),
        };
    }
};

var diff_requests: [constants.MAX_DIFF_REQUESTS]DiffRequest =
    [_]DiffRequest{DiffRequest.init()} ** constants.MAX_DIFF_REQUESTS;
var diff_request_used: [constants.MAX_DIFF_REQUESTS]std.atomic.Value(bool) =
    [_]std.atomic.Value(bool){std.atomic.Value(bool).init(false)} ** constants.MAX_DIFF_REQUESTS;

var diff_thread: ?std.Thread = null;
var diff_thread_running: std.atomic.Value(bool) = std.atomic.Value(bool).init(false);
var diff_thread_mutex: std.Io.Mutex = .init;
var diff_queue_mutex: std.Io.Mutex = .init;
var diff_queue_cond: std.Io.Condition = .init;
var diff_queue_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0);

pub fn initDiffThread() bool {
    if (diff_thread_running.load(.acquire)) return true;

    const io = git_io.get();
    diff_thread_mutex.lock(io) catch unreachable;
    defer diff_thread_mutex.unlock(io);

    if (diff_thread_running.load(.acquire)) return true;

    diff_thread_running.store(true, .release);

    diff_thread = std.Thread.spawn(.{}, diffThreadLoop, .{}) catch {
        diff_thread_running.store(false, .release);
        return false;
    };
    return true;
}

pub fn deinitDiffThread() void {
    const io = git_io.get();
    diff_thread_mutex.lock(io) catch unreachable;
    defer diff_thread_mutex.unlock(io);

    if (!diff_thread_running.load(.acquire)) return;

    diff_thread_running.store(false, .release);

    diff_queue_mutex.lock(io) catch unreachable;
    diff_queue_cond.signal(io);
    diff_queue_mutex.unlock(io);

    if (diff_thread) |thread| {
        thread.join();
        diff_thread = null;
    }
}

fn diffThreadLoop() void {
    git_io.initThreadIo();
    const io = git_io.get();

    while (diff_thread_running.load(.acquire)) {
        diff_queue_mutex.lock(io) catch unreachable;
        while (diff_queue_count.load(.acquire) == 0 and diff_thread_running.load(.acquire)) {
            diff_queue_cond.wait(io, &diff_queue_mutex) catch {};
        }
        diff_queue_mutex.unlock(io);

        if (!diff_thread_running.load(.acquire)) break;

        for (&diff_requests, 0..) |*req, i| {
            if (!diff_request_used[i].load(.acquire)) continue;

            const state = req.state.load(.acquire);
            if (state == .cancelled) {
                freeDiffRequest(@intCast(i));
                _ = diff_queue_count.fetchSub(1, .release);
                continue;
            }
            if (state != .pending) continue;

            const cwd_ptr: [*:0]const u8 = @ptrCast(req.cwd[0..req.cwd_len]);

            var added: c_int = 0;
            var removed: c_int = 0;
            var binary: c_int = 0;
            const ok = computeDiffStats(cwd_ptr, &added, &removed, &binary);

            const new_state: DiffState = if (ok) .complete else .failed;

            // Store results before marking complete to avoid races with poll/free.
            req.added.store(added, .release);
            req.removed.store(removed, .release);
            req.binary.store(binary, .release);

            if (req.state.cmpxchgStrong(.pending, new_state, .acq_rel, .acquire)) |old_state| {
                if (old_state == .cancelled) {
                    freeDiffRequest(@intCast(i));
                }
            }

            _ = diff_queue_count.fetchSub(1, .release);
        }
    }
}

const MAX_DIFF_FILE_BYTES: c.git_off_t = 1024 * 1024;

fn setDiffOptions(options: *c.git_diff_options) void {
    _ = c.git_diff_options_init(options, c.GIT_DIFF_OPTIONS_VERSION);
    options.flags |= c.GIT_DIFF_INCLUDE_UNTRACKED;
    if (@hasDecl(c, "GIT_DIFF_SHOW_UNTRACKED_CONTENT")) {
        options.flags |= c.GIT_DIFF_SHOW_UNTRACKED_CONTENT;
    }
    if (@hasDecl(c, "GIT_DIFF_RECURSE_UNTRACKED_DIRS")) {
        options.flags |= c.GIT_DIFF_RECURSE_UNTRACKED_DIRS;
    }
    // Treat large files as binary to avoid loading huge content into memory.
    options.max_size = MAX_DIFF_FILE_BYTES;
}

fn countBinaryCb(
    _: ?*const c.git_diff_delta,
    _: ?*const c.git_diff_binary,
    payload: ?*anyopaque,
) callconv(.c) c_int {
    if (payload == null) return 0;
    const count_ptr: *c_int = @ptrCast(@alignCast(payload.?));
    count_ptr.* += 1;
    return 0;
}

// Check if a path is effectively ignored by testing each parent directory.
// See the same function in repo_status.zig for detailed rationale.
// Duplicated here because each module has its own @cImport namespace;
// sharing the function across modules would require passing C opaque
// pointer types across @cImport boundaries, which Zig does not allow.
fn isEffectivelyIgnored(repo: *c.git_repository, path: [*:0]const u8) bool {
    var ignored: c_int = 0;

    if (c.git_status_should_ignore(&ignored, repo, path) == 0 and ignored != 0) {
        return true;
    }

    var buf: [constants.MAX_CWD_LEN]u8 = undefined;
    const span = std.mem.span(path);
    if (span.len >= buf.len) return false;
    @memcpy(buf[0..span.len], span);
    buf[span.len] = 0;

    var i: usize = 1;
    while (i < span.len) : (i += 1) {
        if (buf[i] == '/') {
            buf[i] = 0;
            const prefix: [*:0]const u8 = @ptrCast(&buf);
            if (c.git_status_should_ignore(&ignored, repo, prefix) == 0 and ignored != 0) {
                return true;
            }
            buf[i] = '/';
        }
    }

    return false;
}

fn computeDiffStats(
    cwd: [*:0]const u8,
    out_added: *c_int,
    out_removed: *c_int,
    out_binary: *c_int,
) bool {
    git_mutex.lock();
    defer git_mutex.unlock();

    var repo: ?*c.git_repository = null;
    if (c.git_repository_open_ext(&repo, cwd, c.GIT_REPOSITORY_OPEN_FROM_ENV, null) != 0) {
        return false;
    }
    defer c.git_repository_free(repo.?);

    var diff_opts: c.git_diff_options = undefined;
    setDiffOptions(&diff_opts);

    var diff: ?*c.git_diff = null;
    var head_ref: ?*c.git_reference = null;
    var head_commit: ?*c.git_commit = null;
    var head_tree: ?*c.git_tree = null;

    const unborn = if (@hasDecl(c, "git_repository_head_unborn"))
        c.git_repository_head_unborn(repo.?)
    else
        0;

    if (unborn == 1) {
        if (c.git_diff_index_to_workdir(&diff, repo.?, null, &diff_opts) != 0) {
            return false;
        }
    } else {
        if (c.git_repository_head(&head_ref, repo.?) == 0 and head_ref != null) {
            const oid = c.git_reference_target(head_ref.?);
            if (oid != null) {
                if (c.git_commit_lookup(&head_commit, repo.?, oid) == 0 and head_commit != null) {
                    if (c.git_commit_tree(&head_tree, head_commit.?) == 0 and head_tree != null) {
                        if (c.git_diff_tree_to_workdir_with_index(&diff, repo.?, head_tree.?, &diff_opts) != 0) {
                            diff = null;
                        }
                    }
                }
            }
        }

        if (diff == null) {
            if (c.git_diff_index_to_workdir(&diff, repo.?, null, &diff_opts) != 0) {
                if (head_ref) |ref| c.git_reference_free(ref);
                if (head_commit) |commit| c.git_commit_free(commit);
                if (head_tree) |tree| c.git_tree_free(tree);
                return false;
            }
        }
    }

    if (head_ref) |ref| c.git_reference_free(ref);
    if (head_commit) |commit| c.git_commit_free(commit);
    if (head_tree) |tree| c.git_tree_free(tree);

    if (diff == null) {
        return false;
    }
    defer c.git_diff_free(diff.?);

    // Scan deltas for files that are effectively ignored (libgit2 bug:
    // directory-level ignore patterns like ".claude*" prevent the directory
    // from appearing, but files inside still show as diff deltas). For each
    // such delta, count its line contribution and subtract from the totals.
    var ignored_added: usize = 0;
    var ignored_removed: usize = 0;
    var ignored_binary: c_int = 0;

    const num_deltas = c.git_diff_num_deltas(diff.?);
    var delta_idx: usize = 0;
    while (delta_idx < num_deltas) : (delta_idx += 1) {
        const delta = c.git_diff_get_delta(diff.?, delta_idx);
        if (delta == null) continue;

        const new_path = delta.*.new_file.path;
        const old_path = delta.*.old_file.path;

        // Check both new and old paths (renames may have different paths)
        const new_ignored = new_path != null and isEffectivelyIgnored(repo.?, new_path);
        const old_ignored = old_path != null and isEffectivelyIgnored(repo.?, old_path);
        if (!new_ignored and !old_ignored) continue;

        // This delta is effectively ignored. Count its lines.
        if (delta.*.flags & c.GIT_DIFF_FLAG_BINARY != 0) {
            ignored_binary += 1;
            continue;
        }

        var patch: ?*c.git_patch = null;
        if (c.git_patch_from_diff(&patch, diff.?, delta_idx) == 0 and patch != null) {
            var p_add: usize = 0;
            var p_del: usize = 0;
            _ = c.git_patch_line_stats(null, &p_add, &p_del, patch.?);
            ignored_added += p_add;
            ignored_removed += p_del;
            c.git_patch_free(patch.?);
        }
    }

    // If nothing was effectively ignored, use the fast path
    if (ignored_added == 0 and ignored_removed == 0 and ignored_binary == 0) {
        var binary_count: c_int = 0;
        _ = c.git_diff_foreach(diff.?, null, countBinaryCb, null, null, &binary_count);

        var stats: ?*c.git_diff_stats = null;
        if (c.git_diff_get_stats(&stats, diff.?) != 0 or stats == null) {
            return false;
        }
        defer c.git_diff_stats_free(stats.?);

        const added = c.git_diff_stats_insertions(stats.?);
        const removed = c.git_diff_stats_deletions(stats.?);

        out_added.* = @intCast(added);
        out_removed.* = @intCast(removed);
        out_binary.* = binary_count;
        return true;
    }

    // Slow path: subtract ignored line counts from totals
    var binary_count: c_int = 0;
    _ = c.git_diff_foreach(diff.?, null, countBinaryCb, null, null, &binary_count);

    var stats: ?*c.git_diff_stats = null;
    if (c.git_diff_get_stats(&stats, diff.?) != 0 or stats == null) {
        return false;
    }
    defer c.git_diff_stats_free(stats.?);

    const total_added: usize = c.git_diff_stats_insertions(stats.?);
    const total_removed: usize = c.git_diff_stats_deletions(stats.?);

    const effective_added: usize = if (total_added > ignored_added)
        total_added - ignored_added
    else
        0;
    const effective_removed: usize = if (total_removed > ignored_removed)
        total_removed - ignored_removed
    else
        0;
    const effective_binary: c_int = if (binary_count > ignored_binary)
        binary_count - ignored_binary
    else
        0;

    out_added.* = @intCast(effective_added);
    out_removed.* = @intCast(effective_removed);
    out_binary.* = effective_binary;
    return true;
}

pub fn allocDiffRequest() ?u32 {
    for (&diff_request_used, 0..) |*used, i| {
        if (!used.load(.acquire)) {
            if (used.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                return @intCast(i);
            }
        }
    }
    return null;
}

pub fn freeDiffRequest(id: u32) void {
    if (id >= constants.MAX_DIFF_REQUESTS) return;
    diff_request_used[id].store(false, .release);
    diff_requests[id].state.store(.failed, .release);
    diff_requests[id].added.store(0, .release);
    diff_requests[id].removed.store(0, .release);
    diff_requests[id].binary.store(0, .release);
}

pub fn getDiffRequest(id: u32) ?*DiffRequest {
    if (id >= constants.MAX_DIFF_REQUESTS) return null;
    if (!diff_request_used[id].load(.acquire)) return null;
    return &diff_requests[id];
}

pub fn signalDiffQueue() void {
    const io = git_io.get();
    _ = diff_queue_count.fetchAdd(1, .release);
    diff_queue_cond.signal(io);
}
