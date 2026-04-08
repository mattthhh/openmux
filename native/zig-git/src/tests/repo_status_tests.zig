const std = @import("std");
const constants = @import("../constants.zig");
const helpers = @import("../test_helpers.zig");
const c = helpers.c;
const api = @import("../api.zig");

test "repo status counts untracked changes" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try tmp.dir.realpathAlloc(allocator, ".");
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try tmp.dir.writeFile(.{ .sub_path = "untracked.txt", .data = "one\ntwo\n" });

    var branch_buf: [constants.MAX_BRANCH_LEN]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;
    var staged: c_int = 0;
    var unstaged: c_int = 0;
    var untracked: c_int = 0;
    var conflicted: c_int = 0;
    var ahead: c_int = constants.STATUS_UNKNOWN;
    var behind: c_int = constants.STATUS_UNKNOWN;
    var stash: c_int = constants.STATUS_UNKNOWN;
    var state: c_int = 0;
    var detached: u8 = 0;
    var is_worktree: u8 = 0;
    var commondir_buf: [constants.MAX_CWD_LEN]u8 = undefined;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = api.omx_git_repo_status(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
        &staged,
        &unstaged,
        &untracked,
        &conflicted,
        &ahead,
        &behind,
        &stash,
        &state,
        &detached,
        &is_worktree,
        &commondir_buf,
        @as(c_int, @intCast(commondir_buf.len)),
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expectEqual(@as(c_int, 1), untracked);
    try std.testing.expectEqual(@as(c_int, 0), staged);
    try std.testing.expectEqual(@as(c_int, 0), unstaged);
    try std.testing.expectEqual(@as(u8, 1), dirty);
}
