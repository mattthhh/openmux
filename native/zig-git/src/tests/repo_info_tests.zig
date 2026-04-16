const std = @import("std");
const constants = @import("../constants.zig");
const helpers = @import("../test_helpers.zig");
const c = helpers.c;
const api = @import("../api.zig");
const git_io = @import("../io.zig");

test "repo info marks dirty with untracked files" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try tmp.dir.writeFile(git_io.get(), .{ .sub_path = "untracked.txt", .data = "one\ntwo\n" });

    var branch_buf: [constants.MAX_BRANCH_LEN]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = api.omx_git_repo_info(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);
    try std.testing.expect(dirty == 1);
}

test "repo info returns branch after commit" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");

    var branch_buf: [constants.MAX_BRANCH_LEN]u8 = undefined;
    var gitdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var workdir_buf: [constants.MAX_CWD_LEN]u8 = undefined;
    var dirty: u8 = 0;

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const rc = api.omx_git_repo_info(
        repo_path_z,
        &branch_buf,
        branch_buf.len,
        &gitdir_buf,
        gitdir_buf.len,
        &workdir_buf,
        workdir_buf.len,
        &dirty,
    );

    try std.testing.expectEqual(@as(c_int, 0), rc);

    const branch = std.mem.sliceTo(branch_buf[0..], 0);
    try std.testing.expect(std.mem.eql(u8, branch, "main"));
    try std.testing.expect(dirty == 0);
}
