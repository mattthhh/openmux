/**
 * Native libghostty-vt types and constants.
 */

export const enum DirtyState {
  NONE = 0,
  PARTIAL = 1,
  FULL = 2,
}

export const enum CellFlags {
  BOLD = 1 << 0,
  ITALIC = 1 << 1,
  UNDERLINE = 1 << 2,
  STRIKETHROUGH = 1 << 3,
  INVERSE = 1 << 4,
  BLINK = 1 << 6,
  FAINT = 1 << 7,
}

export interface GhosttyCell {
  codepoint: number;
  fg_r: number;
  fg_g: number;
  fg_b: number;
  bg_r: number;
  bg_g: number;
  bg_b: number;
  flags: number;
  width: number;
  hyperlink_id: number;
  grapheme_len: number;
  /** Bit 0: has_default_bg — cell uses terminal default background */
  cell_flags: number;
}

export interface GhosttyTerminalConfig {
  scrollbackLimit?: number;
  fgColor?: number;
  bgColor?: number;
  cursorColor?: number;
  palette?: number[];
}

export const enum GhosttyKittyImageFormat {
  RGB = 0,
  RGBA = 1,
  PNG = 2,
  GRAY_ALPHA = 3,
  GRAY = 4,
}

export const enum GhosttyKittyCompression {
  NONE = 0,
  ZLIB_DEFLATE = 1,
}

export const enum GhosttyKittyPlacementTag {
  INTERNAL = 0,
  EXTERNAL = 1,
}

export interface GhosttyKittyImageInfo {
  id: number;
  number: number;
  width: number;
  height: number;
  data_len: number;
  format: GhosttyKittyImageFormat;
  compression: GhosttyKittyCompression;
  implicit_id: number;
  transmit_time: bigint;
}

export interface GhosttyKittyPlacement {
  image_id: number;
  placement_id: number;
  placement_tag: GhosttyKittyPlacementTag;
  screen_x: number;
  screen_y: number;
  x_offset: number;
  y_offset: number;
  source_x: number;
  source_y: number;
  source_width: number;
  source_height: number;
  columns: number;
  rows: number;
  z: number;
}
