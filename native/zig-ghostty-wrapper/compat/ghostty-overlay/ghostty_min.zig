const terminal = @import("ghostty-src/terminal/main.zig");
const input_key = @import("ghostty-src/input/key.zig");
const input_key_encode = @import("ghostty-src/input/key_encode.zig");

pub const apc = terminal.apc;
pub const color = terminal.color;
pub const device_status = terminal.device_status;
pub const kitty = terminal.kitty;
pub const modes = terminal.modes;

pub const RenderState = terminal.RenderState;
pub const Stream = terminal.Stream;
pub const StreamAction = terminal.StreamAction;
pub const Style = terminal.Style;
pub const Terminal = terminal.Terminal;
pub const CursorStyle = terminal.CursorStyle;
pub const DeviceAttributeReq = terminal.DeviceAttributeReq;

pub const input = struct {
    pub const Key = input_key.Key;
    pub const KeyAction = input_key.Action;
    pub const KeyEvent = input_key.KeyEvent;
    pub const KeyMods = input_key.Mods;
    pub const KeyEncodeOptions = input_key_encode.Options;
    pub const encodeKey = input_key_encode.encode;
};
