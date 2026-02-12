const std = @import("std");
const terminal = @import("../terminal.zig");

const testing = std.testing;

test "smoke: device status response buffer" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    terminal.write(term, "\x1b[6n", 4);
    try testing.expect(terminal.hasResponse(term));

    var buf: [32]u8 = undefined;
    const written = terminal.readResponse(term, &buf, buf.len);
    try testing.expect(written > 0);
    try testing.expectEqualStrings("\x1b[1;1R", buf[0..@intCast(written)]);
}

test "response buffer supports partial reads" {
    const term = terminal.new(80, 24);
    defer terminal.free(term);

    const query = "\x1b[5n\x1b[6n";
    terminal.write(term, query, query.len);

    const expected = "\x1b[0n\x1b[1;1R";
    var collected: [32]u8 = undefined;
    var total: usize = 0;
    var chunk: [4]u8 = undefined;

    while (true) {
        const n = terminal.readResponse(term, &chunk, chunk.len);
        if (n <= 0) break;
        const read_len: usize = @intCast(n);
        std.mem.copyForwards(
            u8,
            collected[total .. total + read_len],
            chunk[0..read_len],
        );
        total += read_len;
    }

    try testing.expectEqualStrings(expected, collected[0..total]);
    try testing.expect(!terminal.hasResponse(term));
    try testing.expectEqual(@as(c_int, 0), terminal.readResponse(term, &chunk, chunk.len));
}
