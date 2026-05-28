/**
 * Tests for cell serialization utilities
 * These utilities pack/unpack terminal cells for efficient Web Worker transfer
 */

import { describe, it, expect } from 'bun:test';
import {
  packCells,
  unpackCells,
  packDirtyUpdate,
  unpackDirtyUpdate,
  packTerminalState,
  unpackTerminalState,
} from '../../src/terminal/cell-serialization';
import type {
  TerminalCell,
  TerminalState,
  DirtyTerminalUpdate,
  TerminalScrollState,
} from '../../src/core/types';

describe('cell-serialization', () => {
  describe('packCells/unpackCells', () => {
    it('should pack and unpack a simple cell array', () => {
      const cells: TerminalCell[] = [
        {
          char: 'H',
          fg: { r: 255, g: 255, b: 255 },
          bg: { r: 0, g: 0, b: 0 },
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
          blink: false,
          dim: false,
          width: 1,
        },
        {
          char: 'i',
          fg: { r: 255, g: 255, b: 255 },
          bg: { r: 0, g: 0, b: 0 },
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
          blink: false,
          dim: false,
          width: 1,
        },
      ];

      const packed = packCells(cells);
      expect(packed).toBeInstanceOf(ArrayBuffer);
      expect(packed.byteLength).toBe(cells.length * 16); // 16 bytes per cell

      const unpacked = unpackCells(packed);
      expect(unpacked.length).toBe(cells.length);
      expect(unpacked[0].char).toBe('H');
      expect(unpacked[1].char).toBe('i');
    });

    it('should preserve cell attributes', () => {
      const cell: TerminalCell = {
        char: 'X',
        fg: { r: 100, g: 150, b: 200 },
        bg: { r: 50, g: 60, b: 70 },
        bold: true,
        italic: true,
        underline: true,
        strikethrough: true,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      };

      const packed = packCells([cell]);
      const unpacked = unpackCells(packed);

      expect(unpacked[0].char).toBe('X');
      expect(unpacked[0].fg).toEqual({ r: 100, g: 150, b: 200 });
      expect(unpacked[0].bg).toEqual({ r: 50, g: 60, b: 70 });
      expect(unpacked[0].bold).toBe(true);
      expect(unpacked[0].italic).toBe(true);
      expect(unpacked[0].underline).toBe(true);
      expect(unpacked[0].strikethrough).toBe(true);
      expect(unpacked[0].inverse).toBe(false);
      expect(unpacked[0].blink).toBe(false);
      expect(unpacked[0].dim).toBe(false);
    });

    it('should handle wide characters', () => {
      const cells: TerminalCell[] = [
        {
          char: '日',
          fg: { r: 255, g: 255, b: 255 },
          bg: { r: 0, g: 0, b: 0 },
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
          blink: false,
          dim: false,
          width: 2,
        },
      ];

      const packed = packCells(cells);
      const unpacked = unpackCells(packed);

      expect(unpacked[0].char).toBe('日');
      expect(unpacked[0].width).toBe(2);
    });

    it('should handle empty cell array', () => {
      const packed = packCells([]);
      const unpacked = unpackCells(packed);

      expect(unpacked.length).toBe(0);
    });

    it('should handle emoji characters', () => {
      const cells: TerminalCell[] = [
        {
          char: '🚀',
          fg: { r: 255, g: 255, b: 255 },
          bg: { r: 0, g: 0, b: 0 },
          bold: false,
          italic: false,
          underline: false,
          strikethrough: false,
          inverse: false,
          blink: false,
          dim: false,
          width: 2,
        },
      ];

      const packed = packCells(cells);
      const unpacked = unpackCells(packed);

      expect(unpacked[0].char).toBe('🚀');
    });
  });

  describe('packDirtyUpdate/unpackDirtyUpdate', () => {
    it('should pack and unpack a dirty update', () => {
      const scrollState: TerminalScrollState = {
        viewportOffset: 10,
        scrollbackLength: 100,
        isAtBottom: false,
      };

      // Create full rows with 3 cells each (cols = 3)
      const row0 = [createTestCell('A'), createTestCell('B'), createTestCell('C')];
      const row2 = [createTestCell('X'), createTestCell('Y'), createTestCell('Z')];

      const update: DirtyTerminalUpdate = {
        dirtyRows: new Map([
          [0, row0],
          [2, row2],
        ]),
        cursor: { x: 5, y: 3, visible: true, style: 'block' },
        scrollState,
        cols: 3,
        rows: 24,
        isFull: false,
        alternateScreen: false,
        mouseTracking: true,
        cursorKeyMode: 'normal',
      };

      const packed = packDirtyUpdate(update);
      const unpacked = unpackDirtyUpdate(packed, scrollState);

      expect(unpacked.cols).toBe(3);
      expect(unpacked.rows).toBe(24);
      expect(unpacked.cursor.x).toBe(5);
      expect(unpacked.cursor.y).toBe(3);
      expect(unpacked.cursor.visible).toBe(true);
      expect(unpacked.isFull).toBe(false);
      expect(unpacked.alternateScreen).toBe(false);
      expect(unpacked.mouseTracking).toBe(true);
      expect(unpacked.cursorKeyMode).toBe('normal');
      expect(unpacked.dirtyRows.size).toBe(2);
      expect(unpacked.dirtyRows.get(0)?.[0].char).toBe('A');
      expect(unpacked.dirtyRows.get(2)?.[0].char).toBe('X');
    });

    it('should handle full update with fullState', () => {
      const scrollState: TerminalScrollState = {
        viewportOffset: 0,
        scrollbackLength: 50,
        isAtBottom: true,
      };

      const fullState: TerminalState = {
        cols: 2,
        rows: 2,
        cells: [
          [createTestCell('X'), createTestCell('Y')],
          [createTestCell('Z'), createTestCell('W')],
        ],
        cursor: { x: 0, y: 0, visible: true, style: 'block' },
        alternateScreen: true,
        mouseTracking: false,
        cursorKeyMode: 'application',
        kittyKeyboardFlags: 3,
      };

      const update: DirtyTerminalUpdate = {
        dirtyRows: new Map(),
        cursor: fullState.cursor,
        scrollState,
        cols: 2,
        rows: 2,
        isFull: true,
        fullState,
        alternateScreen: true,
        mouseTracking: false,
        cursorKeyMode: 'application',
        kittyKeyboardFlags: 3,
      };

      const packed = packDirtyUpdate(update);
      const unpacked = unpackDirtyUpdate(packed, scrollState);

      expect(unpacked.isFull).toBe(true);
      expect(unpacked.fullState).toBeDefined();
      expect(unpacked.fullState?.cells[0][0].char).toBe('X');
      expect(unpacked.fullState?.cells[1][1].char).toBe('W');
      expect(unpacked.cursorKeyMode).toBe('application');
      expect(unpacked.kittyKeyboardFlags).toBe(3);
    });
  });

  describe('packTerminalState/unpackTerminalState', () => {
    it('should pack and unpack terminal state', () => {
      const state: TerminalState = {
        cols: 80,
        rows: 3,
        cells: [
          [createTestCell('H'), createTestCell('e'), createTestCell('l')],
          [createTestCell('l'), createTestCell('o'), createTestCell(' ')],
          [createTestCell('W'), createTestCell('o'), createTestCell('r')],
        ],
        cursor: { x: 2, y: 1, visible: true, style: 'block' },
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 5,
      };

      const packed = packTerminalState(state);
      const unpacked = unpackTerminalState(packed, 80, 3);

      expect(unpacked.cols).toBe(80);
      expect(unpacked.rows).toBe(3);
      expect(unpacked.cells.length).toBe(3);
      expect(unpacked.cells[0][0].char).toBe('H');
      expect(unpacked.cells[1][1].char).toBe('o');
      expect(unpacked.cells[2][2].char).toBe('r');
      expect(unpacked.kittyKeyboardFlags).toBe(5);
    });
  });
});

// Helper to create test cells
function createTestCell(char: string): TerminalCell {
  return {
    char,
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}
