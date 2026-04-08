const api = @import("api.zig");

pub export fn omx_git_init() c_int {
    return api.omx_git_init();
}

pub export fn omx_git_shutdown() c_int {
    return api.omx_git_shutdown();
}

pub export fn omx_git_repo_info(
    cwd: [*:0]const u8,
    branch_buf: [*]u8,
    branch_len: c_int,
    gitdir_buf: [*]u8,
    gitdir_len: c_int,
    workdir_buf: [*]u8,
    workdir_len: c_int,
    dirty_out: *u8,
) c_int {
    return api.omx_git_repo_info(
        cwd,
        branch_buf,
        branch_len,
        gitdir_buf,
        gitdir_len,
        workdir_buf,
        workdir_len,
        dirty_out,
    );
}

pub export fn omx_git_repo_status(
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
    return api.omx_git_repo_status(
        cwd,
        branch_buf,
        branch_len,
        gitdir_buf,
        gitdir_len,
        workdir_buf,
        workdir_len,
        dirty_out,
        staged_out,
        unstaged_out,
        untracked_out,
        conflicted_out,
        ahead_out,
        behind_out,
        stash_out,
        state_out,
        detached_out,
        is_worktree_out,
        commondir_buf,
        commondir_len,
    );
}

pub export fn omx_git_diff_stats_async(cwd: [*:0]const u8) c_int {
    return api.omx_git_diff_stats_async(cwd);
}

pub export fn omx_git_status_async(cwd: [*:0]const u8) c_int {
    return api.omx_git_status_async(cwd);
}

pub export fn omx_git_diff_stats_poll(
    request_id: c_int,
    out_added: *c_int,
    out_removed: *c_int,
    out_binary: *c_int,
) c_int {
    return api.omx_git_diff_stats_poll(request_id, out_added, out_removed, out_binary);
}

pub export fn omx_git_status_poll(
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
    return api.omx_git_status_poll(
        request_id,
        branch_buf,
        branch_len,
        gitdir_buf,
        gitdir_len,
        workdir_buf,
        workdir_len,
        dirty_out,
        staged_out,
        unstaged_out,
        untracked_out,
        conflicted_out,
        ahead_out,
        behind_out,
        stash_out,
        state_out,
        detached_out,
        is_worktree_out,
        commondir_buf,
        commondir_len,
    );
}

pub export fn omx_git_diff_stats_cancel(request_id: c_int) void {
    api.omx_git_diff_stats_cancel(request_id);
}

pub export fn omx_git_status_cancel(request_id: c_int) void {
    api.omx_git_status_cancel(request_id);
}

test {
    _ = @import("tests/main.zig");
}
