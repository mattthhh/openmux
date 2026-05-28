/**
 * Tests for GhosttyVtTerminal with mocked FFI bindings.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'bun:test';
import { mockGhostty, resetGhosttySymbols } from '../mocks/ghostty-ffi';

let GhosttyVtTerminal: typeof import('../../src/terminal/ghostty-vt/terminal').GhosttyVtTerminal;

beforeAll(async () => {
  ({ GhosttyVtTerminal } = await import(
    `../../src/terminal/ghostty-vt/terminal?test=${Date.now()}`
  ));
});

beforeEach(() => {
  resetGhosttySymbols();
});

const CELL_SIZE = 16;
const KITTY_PLACEMENT_SIZE = 56;

type CellInput = {
  codepoint: number;
  fg: [number, number, number];
  bg: [number, number, number];
  flags?: number;
  width?: number;
  hyperlinkId?: number;
  graphemeLen?: number;
};

function writeCell(buffer: Buffer, index: number, cell: CellInput): void {
  const offset = index * CELL_SIZE;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, cell.codepoint, true);
  buffer[offset + 4] = cell.fg[0];
  buffer[offset + 5] = cell.fg[1];
  buffer[offset + 6] = cell.fg[2];
  buffer[offset + 7] = cell.bg[0];
  buffer[offset + 8] = cell.bg[1];
  buffer[offset + 9] = cell.bg[2];
  buffer[offset + 10] = cell.flags ?? 0;
  buffer[offset + 11] = cell.width ?? 1;
  view.setUint16(offset + 12, cell.hyperlinkId ?? 0, true);
  buffer[offset + 14] = cell.graphemeLen ?? 0;
  buffer[offset + 15] = 0;
}

function writeKittyImageInfo(
  buffer: Buffer,
  info: {
    id: number;
    number: number;
    width: number;
    height: number;
    data_len: number;
    format: number;
    compression: number;
    implicit_id: number;
    transmit_time: bigint;
  }
): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(0, info.id, true);
  view.setUint32(4, info.number, true);
  view.setUint32(8, info.width, true);
  view.setUint32(12, info.height, true);
  view.setUint32(16, info.data_len, true);
  view.setUint8(20, info.format);
  view.setUint8(21, info.compression);
  view.setUint8(22, info.implicit_id);
  view.setUint8(23, 0);
  view.setBigUint64(24, info.transmit_time, true);
}

function writeKittyPlacement(
  buffer: Buffer,
  index: number,
  placement: {
    image_id: number;
    placement_id: number;
    placement_tag: number;
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
): void {
  const offset = index * KITTY_PLACEMENT_SIZE;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(offset, placement.image_id, true);
  view.setUint32(offset + 4, placement.placement_id, true);
  view.setUint8(offset + 8, placement.placement_tag);
  view.setUint32(offset + 12, placement.screen_x, true);
  view.setUint32(offset + 16, placement.screen_y, true);
  view.setUint32(offset + 20, placement.x_offset, true);
  view.setUint32(offset + 24, placement.y_offset, true);
  view.setUint32(offset + 28, placement.source_x, true);
  view.setUint32(offset + 32, placement.source_y, true);
  view.setUint32(offset + 36, placement.source_width, true);
  view.setUint32(offset + 40, placement.source_height, true);
  view.setUint32(offset + 44, placement.columns, true);
  view.setUint32(offset + 48, placement.rows, true);
  view.setInt32(offset + 52, placement.z, true);
}

describe('GhosttyVtTerminal', () => {
  it('passes config to native constructor', () => {
    let capturedConfig: Buffer | null = null;

    const ghosttyTerminalNew = vi.fn(() => 1);
    const ghosttyTerminalNewWithConfig = vi.fn((_cols: number, _rows: number, config: Buffer) => {
      capturedConfig = Buffer.from(config);
      return 1;
    });

    mockGhostty.symbols = {
      ghostty_terminal_new: ghosttyTerminalNew,
      ghostty_terminal_new_with_config: ghosttyTerminalNewWithConfig,
      ghostty_terminal_free: vi.fn(),
    };

    const palette = Array.from({ length: 16 }, (_, i) => 0x100000 + i);
    const term = new GhosttyVtTerminal(80, 24, {
      scrollbackLimit: 1234,
      fgColor: 0x112233,
      bgColor: 0x445566,
      cursorColor: 0x778899,
      palette,
    });

    term.free();

    expect(ghosttyTerminalNew).not.toHaveBeenCalled();
    expect(ghosttyTerminalNewWithConfig).toHaveBeenCalledTimes(1);
    expect(capturedConfig).not.toBeNull();

    const view = new DataView(
      capturedConfig!.buffer,
      capturedConfig!.byteOffset,
      capturedConfig!.byteLength
    );
    expect(view.getUint32(0, true)).toBe(1234);
    expect(view.getUint32(4, true)).toBe(0x112233);
    expect(view.getUint32(8, true)).toBe(0x445566);
    expect(view.getUint32(12, true)).toBe(0x778899);

    const paletteOffset = 16;
    for (let i = 0; i < 16; i++) {
      expect(view.getUint32(paletteOffset + i * 4, true)).toBe(palette[i]);
    }
  });

  it('parses viewport cells into the pool', () => {
    const viewportData = Buffer.alloc(CELL_SIZE * 2);
    writeCell(viewportData, 0, {
      codepoint: 0x41,
      fg: [1, 2, 3],
      bg: [4, 5, 6],
      flags: 5,
      width: 1,
      hyperlinkId: 9,
    });
    writeCell(viewportData, 1, {
      codepoint: 0x42,
      fg: [7, 8, 9],
      bg: [10, 11, 12],
      flags: 0x80,
      width: 2,
      hyperlinkId: 257,
      graphemeLen: 1,
    });

    const viewportMock = vi.fn((_handle: number, outBuffer: Buffer, totalCells: number) => {
      expect(totalCells).toBe(2);
      viewportData.copy(outBuffer);
      return 2;
    });

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_render_state_get_viewport: viewportMock,
    };

    const term = new GhosttyVtTerminal(2, 1);

    const first = term.getViewport();
    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      codepoint: 0x41,
      fg_r: 1,
      fg_g: 2,
      fg_b: 3,
      bg_r: 4,
      bg_g: 5,
      bg_b: 6,
      flags: 5,
      width: 1,
      hyperlink_id: 9,
      grapheme_len: 0,
    });
    expect(first[1].codepoint).toBe(0x42);
    expect(first[1].width).toBe(2);
    expect(first[1].hyperlink_id).toBe(257);
    expect(first[1].grapheme_len).toBe(1);

    const firstCell = first[0];
    const second = term.getViewport();
    expect(second[0]).toBe(firstCell);

    term.free();
  });

  it('parses scrollback lines into new arrays', () => {
    const lineData = Buffer.alloc(CELL_SIZE * 2);
    writeCell(lineData, 0, {
      codepoint: 0x43,
      fg: [11, 12, 13],
      bg: [14, 15, 16],
      flags: 1,
      width: 1,
      hyperlinkId: 0,
    });
    writeCell(lineData, 1, {
      codepoint: 0x44,
      fg: [21, 22, 23],
      bg: [24, 25, 26],
      flags: 2,
      width: 1,
      hyperlinkId: 3,
    });

    const scrollbackMock = vi.fn(
      (_handle: number, _offset: number, outBuffer: Buffer, cols: number) => {
        expect(cols).toBe(2);
        lineData.copy(outBuffer);
        return 2;
      }
    );

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_get_scrollback_line: scrollbackMock,
    };

    const term = new GhosttyVtTerminal(2, 1);
    const line = term.getScrollbackLine(0);
    expect(line).not.toBeNull();
    expect(line![0].codepoint).toBe(0x43);
    expect(line![1].fg_r).toBe(21);
    expect(line![1].bg_b).toBe(26);

    term.free();
  });

  it('reads terminal responses when available', () => {
    const readMock = vi.fn((_handle: number, buffer: Buffer, _size: number) => {
      buffer.write('OK');
      return 2;
    });

    const hasResponseMock = vi.fn(() => true);

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_has_response: hasResponseMock,
      ghostty_terminal_read_response: readMock,
    };

    const term = new GhosttyVtTerminal(80, 24);
    expect(term.readResponse()).toBe('OK');

    mockGhostty.symbols.ghostty_terminal_has_response = vi.fn(() => false);
    expect(term.readResponse()).toBeNull();

    term.free();
  });

  it('reads kitty image metadata and data', () => {
    const info = {
      id: 42,
      number: 7,
      width: 2,
      height: 3,
      data_len: 6,
      format: 0,
      compression: 0,
      implicit_id: 1,
      transmit_time: 987654321n,
    };
    const imageData = Buffer.from([1, 2, 3, 4, 5, 6]);

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_get_kitty_image_count: vi.fn(() => 1),
      ghostty_terminal_get_kitty_image_ids: vi.fn(
        (_handle: number, outBuffer: Buffer, count: number) => {
          expect(count).toBe(1);
          outBuffer.writeUInt32LE(info.id, 0);
          return 1;
        }
      ),
      ghostty_terminal_get_kitty_image_info: vi.fn(
        (_handle: number, imageId: number, outBuffer: Buffer) => {
          expect(imageId).toBe(info.id);
          writeKittyImageInfo(outBuffer, info);
          return true;
        }
      ),
      ghostty_terminal_copy_kitty_image_data: vi.fn(
        (_handle: number, imageId: number, outBuffer: Buffer, size: number) => {
          expect(imageId).toBe(info.id);
          expect(size).toBe(imageData.length);
          imageData.copy(outBuffer);
          return imageData.length;
        }
      ),
    };

    const term = new GhosttyVtTerminal(2, 2);
    expect(term.getKittyImageIds()).toEqual([42]);

    const meta = term.getKittyImageInfo(42);
    expect(meta).not.toBeNull();
    expect(meta?.width).toBe(info.width);
    expect(meta?.height).toBe(info.height);
    expect(meta?.data_len).toBe(info.data_len);
    expect(meta?.implicit_id).toBe(1);
    expect(meta?.transmit_time).toBe(info.transmit_time);

    const data = term.getKittyImageData(42);
    expect(data).not.toBeNull();
    expect(Buffer.from(data!)).toEqual(imageData);

    term.free();
  });

  it('reads kitty placements', () => {
    const placement = {
      image_id: 3,
      placement_id: 9,
      placement_tag: 1,
      screen_x: 4,
      screen_y: 5,
      x_offset: 6,
      y_offset: 7,
      source_x: 1,
      source_y: 2,
      source_width: 10,
      source_height: 12,
      columns: 2,
      rows: 3,
      z: -4,
    };

    mockGhostty.symbols = {
      ghostty_terminal_new: vi.fn(() => 1),
      ghostty_terminal_free: vi.fn(),
      ghostty_terminal_get_kitty_placement_count: vi.fn(() => 1),
      ghostty_terminal_get_kitty_placements: vi.fn(
        (_handle: number, outBuffer: Buffer, count: number) => {
          expect(count).toBe(1);
          writeKittyPlacement(outBuffer, 0, placement);
          return 1;
        }
      ),
    };

    const term = new GhosttyVtTerminal(2, 2);
    const placements = term.getKittyPlacements();
    expect(placements).toHaveLength(1);
    expect(placements[0]?.image_id).toBe(placement.image_id);
    expect(placements[0]?.placement_tag).toBe(placement.placement_tag);
    expect(placements[0]?.screen_x).toBe(placement.screen_x);
    expect(placements[0]?.z).toBe(placement.z);

    term.free();
  });
});
