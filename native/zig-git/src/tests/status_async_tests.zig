const std = @import("std");
const constants = @import("../constants.zig");
const helpers = @import("../test_helpers.zig");
const c = helpers.c;
const api = @import("../api.zig");
const sleep_util = @import("../sleep.zig");

test "status async reports branch after commit" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_status_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

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

    var status: c_int = constants.STATUS_PENDING;
    while (status == constants.STATUS_PENDING) {
        status = api.omx_git_status_poll(
            req_id,
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
        if (status == constants.STATUS_PENDING) {
            sleep_util.sleepMilliseconds(1);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    const branch = std.mem.sliceTo(branch_buf[0..], 0);
    try std.testing.expect(std.mem.eql(u8, branch, "main"));
    try std.testing.expectEqual(@as(u8, 0), dirty);
    try std.testing.expectEqual(@as(u8, 0), detached);
}
