const std = @import("std");
const constants = @import("../constants.zig");
const helpers = @import("../test_helpers.zig");
const c = helpers.c;
const api = @import("../api.zig");
const sleep_util = @import("../sleep.zig");
const git_io = @import("../io.zig");

test "diff stats include tracked changes" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "a\nb\n");
    try tmp.dir.writeFile(git_io.get(), .{ .sub_path = "tracked.txt", .data = "a\nb\nc\n" });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            sleep_util.sleepMilliseconds(1);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    try std.testing.expectEqual(@as(c_int, 1), added);
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 0), binary);
}

test "diff stats include untracked changes" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "first\n");
    try tmp.dir.writeFile(git_io.get(), .{ .sub_path = "untracked.txt", .data = "one\ntwo\nthree\n" });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            sleep_util.sleepMilliseconds(1);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    if (@hasDecl(c, "GIT_DIFF_SHOW_UNTRACKED_CONTENT")) {
        try std.testing.expectEqual(@as(c_int, 3), added);
    } else {
        try std.testing.expectEqual(@as(c_int, 0), added);
    }
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 0), binary);
}

test "diff stats count binary changes separately" {
    _ = api.omx_git_init();

    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const allocator = std.testing.allocator;
    const repo_path = try helpers.tmpDirPathAlloc(allocator, &tmp);
    defer allocator.free(repo_path);

    const repo = try helpers.initRepo(allocator, repo_path);
    defer c.git_repository_free(@as(?*c.git_repository, repo));

    try helpers.commitFile(allocator, repo, tmp.dir, "tracked.txt", "a\n");

    const binary_size: usize = 1024 * 1024 + 1;
    const binary_data = try allocator.alloc(u8, binary_size);
    defer allocator.free(binary_data);
    @memset(binary_data, 0);

    try tmp.dir.writeFile(git_io.get(), .{ .sub_path = "tracked.txt", .data = binary_data });

    const repo_path_z = try allocator.dupeZ(u8, repo_path);
    defer allocator.free(repo_path_z);

    const req_id = api.omx_git_diff_stats_async(repo_path_z);
    try std.testing.expect(req_id >= 0);

    var added: c_int = 0;
    var removed: c_int = 0;
    var binary: c_int = 0;
    var status: c_int = constants.DIFF_PENDING;

    while (status == constants.DIFF_PENDING) {
        status = api.omx_git_diff_stats_poll(req_id, &added, &removed, &binary);
        if (status == constants.DIFF_PENDING) {
            sleep_util.sleepMilliseconds(1);
        }
    }

    try std.testing.expectEqual(@as(c_int, 0), status);
    try std.testing.expectEqual(@as(c_int, 0), added);
    try std.testing.expectEqual(@as(c_int, 0), removed);
    try std.testing.expectEqual(@as(c_int, 1), binary);
}
