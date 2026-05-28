// zig-git memory strategy:
// All request/response data uses fixed-size stack arrays (static allocation).
// No dynamic (heap) allocation at all — following the TigerBeetle pattern.
// libgit2 resources are cleaned up with defer git_*_free() on every path.
// A global mutex serializes all libgit2 calls (libgit2 is not thread-safe).

const std = @import("std");
const c = @cImport({
    @cInclude("git2.h");
});

const constants = @import("constants.zig");
const async_diff = @import("async_diff.zig");
const async_status = @import("async_status.zig");
const repo_status = @import("repo_status.zig");

pub fn omx_git_init() c_int {
    return c.git_libgit2_init();
}

pub fn omx_git_shutdown() c_int {
    async_diff.deinitDiffThread();
    async_status.deinitStatusThread();
    return c.git_libgit2_shutdown();
}

pub fn omx_git_repo_info(
    cwd: [*:0]const u8,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
) c_int {
    var status = repo_status.RepoStatus{};
    repo_status.clearRepoStatus(&status);
    if (!repo_status.computeRepoStatus(cwd, &status)) {
        if (branch_len > 0) repo_status.clearBuffer(branch_buf, @intCast(branch_len));
        if (gitdir_len > 0) repo_status.clearBuffer(gitdir_buf, @intCast(gitdir_len));
        if (workdir_len > 0) repo_status.clearBuffer(workdir_buf, @intCast(workdir_len));
        dirty_out.* = 0;
        return constants.ERROR;
    }

    if (branch_len > 0) {
        repo_status.copyCString(branch_buf, @intCast(branch_len), status.branch[0..]);
    }
    if (gitdir_len > 0) {
        repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), status.gitdir[0..]);
    }
    if (workdir_len > 0) {
        repo_status.copyCString(workdir_buf, @intCast(workdir_len), status.workdir[0..]);
    }
    dirty_out.* = status.dirty;
    return 0;
}

pub fn omx_git_repo_status(
    cwd: [*:0]const u8,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
    staged_out: *c_int,
    unstaged_out: *c_int,
    untracked_out: *c_int,
    conflicted_out: *c_int,
    ahead_out: *c_int,
    behind_out: *c_int,
    stash_out: *c_int,
    state_out: *c_int,
    detached_out: *u8,
    is_worktree_out: *u8,
    commondir_buf: [*]u8,
    commondir_len: c_int,
) c_int {
    var status = repo_status.RepoStatus{};
    repo_status.clearRepoStatus(&status);
    if (!repo_status.computeRepoStatus(cwd, &status)) {
        if (branch_len > 0) repo_status.clearBuffer(branch_buf, @intCast(branch_len));
        if (gitdir_len > 0) repo_status.clearBuffer(gitdir_buf, @intCast(gitdir_len));
        if (workdir_len > 0) repo_status.clearBuffer(workdir_buf, @intCast(workdir_len));
        dirty_out.* = 0;
        staged_out.* = 0;
        unstaged_out.* = 0;
        untracked_out.* = 0;
        conflicted_out.* = 0;
        ahead_out.* = constants.STATUS_UNKNOWN;
        behind_out.* = constants.STATUS_UNKNOWN;
        stash_out.* = constants.STATUS_UNKNOWN;
        state_out.* = 0;
        detached_out.* = 0;
        is_worktree_out.* = 0;
        if (commondir_len > 0) repo_status.clearBuffer(commondir_buf, @intCast(commondir_len));
        return constants.ERROR;
    }

    if (branch_len > 0) {
        repo_status.copyCString(branch_buf, @intCast(branch_len), status.branch[0..]);
    }
    if (gitdir_len > 0) {
        repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), status.gitdir[0..]);
    }
    if (workdir_len > 0) {
        repo_status.copyCString(workdir_buf, @intCast(workdir_len), status.workdir[0..]);
    }

    dirty_out.* = status.dirty;
    staged_out.* = status.staged;
    unstaged_out.* = status.unstaged;
    untracked_out.* = status.untracked;
    conflicted_out.* = status.conflicted;
    ahead_out.* = status.ahead;
    behind_out.* = status.behind;
    stash_out.* = status.stash_count;
    state_out.* = status.state;
    detached_out.* = status.detached;
    is_worktree_out.* = status.is_worktree;
    if (commondir_len > 0) {
        repo_status.copyCString(commondir_buf, @intCast(commondir_len), status.commondir[0..]);
    }
    return 0;
}

pub fn omx_git_diff_stats_async(cwd: [*:0]const u8) c_int {
    if (!async_diff.initDiffThread()) {
        return constants.ERROR;
    }

    const req_id = async_diff.allocDiffRequest() orelse return constants.ERROR;
    const req = async_diff.getDiffRequest(req_id) orelse return constants.ERROR;

    var cwd_len: usize = 0;
    while (cwd[cwd_len] != 0 and cwd_len < constants.MAX_CWD_LEN - 1) : (cwd_len += 1) {
        req.cwd[cwd_len] = cwd[cwd_len];
    }
    req.cwd[cwd_len] = 0;
    req.cwd_len = cwd_len + 1;
    req.state.store(.pending, .release);
    req.added.store(0, .release);
    req.removed.store(0, .release);
    req.binary.store(0, .release);

    async_diff.signalDiffQueue();

    return @intCast(req_id);
}

pub fn omx_git_status_async(cwd: [*:0]const u8) c_int {
    if (!async_status.initStatusThread()) {
        return constants.ERROR;
    }

    const req_id = async_status.allocStatusRequest() orelse return constants.ERROR;
    const req = async_status.getStatusRequest(req_id) orelse return constants.ERROR;

    var cwd_len: usize = 0;
    while (cwd[cwd_len] != 0 and cwd_len < constants.MAX_CWD_LEN - 1) : (cwd_len += 1) {
        req.cwd[cwd_len] = cwd[cwd_len];
    }
    req.cwd[cwd_len] = 0;
    req.cwd_len = cwd_len + 1;
    req.state.store(.pending, .release);
    repo_status.clearRepoStatus(&req.status);

    async_status.signalStatusQueue();

    return @intCast(req_id);
}

pub fn omx_git_diff_stats_poll(
    request_id: c_int,
    out_added: *c_int,
    out_removed: *c_int,
    out_binary: *c_int,
) c_int {
    if (request_id < 0) return constants.DIFF_ERROR;

    const req = async_diff.getDiffRequest(@intCast(request_id)) orelse return constants.DIFF_ERROR;
    const state = req.state.load(.acquire);

    switch (state) {
        .pending => return constants.DIFF_PENDING,
        .complete => {
            out_added.* = req.added.load(.acquire);
            out_removed.* = req.removed.load(.acquire);
            out_binary.* = req.binary.load(.acquire);
            async_diff.freeDiffRequest(@intCast(request_id));
            return 0;
        },
        .failed => {
            async_diff.freeDiffRequest(@intCast(request_id));
            return constants.DIFF_ERROR;
        },
        .cancelled => {
            async_diff.freeDiffRequest(@intCast(request_id));
            return constants.DIFF_ERROR;
        },
    }
}

pub fn omx_git_status_poll(
    request_id: c_int,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
    staged_out: *c_int,
    unstaged_out: *c_int,
    untracked_out: *c_int,
    conflicted_out: *c_int,
    ahead_out: *c_int,
    behind_out: *c_int,
    stash_out: *c_int,
    state_out: *c_int,
    detached_out: *u8,
    is_worktree_out: *u8,
    commondir_buf: [*]u8,
    commondir_len: c_int,
) c_int {
    if (request_id < 0) return constants.STATUS_ERROR;

    const req = async_status.getStatusRequest(@intCast(request_id)) orelse return constants.STATUS_ERROR;
    const state = req.state.load(.acquire);

    switch (state) {
        .pending => return constants.STATUS_PENDING,
        .complete => {
            if (branch_len > 0) {
                repo_status.copyCString(branch_buf, @intCast(branch_len), req.status.branch[0..]);
            }
            if (gitdir_len > 0) {
                repo_status.copyCString(gitdir_buf, @intCast(gitdir_len), req.status.gitdir[0..]);
            }
            if (workdir_len > 0) {
                repo_status.copyCString(workdir_buf, @intCast(workdir_len), req.status.workdir[0..]);
            }

            dirty_out.* = req.status.dirty;
            staged_out.* = req.status.staged;
            unstaged_out.* = req.status.unstaged;
            untracked_out.* = req.status.untracked;
            conflicted_out.* = req.status.conflicted;
            ahead_out.* = req.status.ahead;
            behind_out.* = req.status.behind;
            stash_out.* = req.status.stash_count;
            state_out.* = req.status.state;
            detached_out.* = req.status.detached;
            is_worktree_out.* = req.status.is_worktree;
            if (commondir_len > 0) {
                repo_status.copyCString(commondir_buf, @intCast(commondir_len), req.status.commondir[0..]);
            }

            async_status.freeStatusRequest(@intCast(request_id));
            return 0;
        },
        .failed => {
            async_status.freeStatusRequest(@intCast(request_id));
            return constants.STATUS_ERROR;
        },
        .cancelled => {
            async_status.freeStatusRequest(@intCast(request_id));
            return constants.STATUS_ERROR;
        },
    }
}

pub fn omx_git_diff_stats_cancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_diff.getDiffRequest(@intCast(request_id)) orelse return;

    if (req.state.cmpxchgStrong(.pending, .cancelled, .acq_rel, .acquire)) |old_state| {
        switch (old_state) {
            .complete, .failed => {
                async_diff.freeDiffRequest(@intCast(request_id));
            },
            .pending, .cancelled => {},
        }
    }
}

pub fn omx_git_status_cancel(request_id: c_int) void {
    if (request_id < 0) return;

    const req = async_status.getStatusRequest(@intCast(request_id)) orelse return;

    if (req.state.cmpxchgStrong(.pending, .cancelled, .acq_rel, .acquire)) |old_state| {
        switch (old_state) {
            .complete, .failed => {
                async_status.freeStatusRequest(@intCast(request_id));
            },
            .pending, .cancelled => {},
        }
    }
}
