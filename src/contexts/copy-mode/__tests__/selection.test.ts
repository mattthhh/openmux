/**
 * Selection module comprehensive tests
 */

import { describe, it, expect } from 'bun:test';
import {
  buildSelection,
  recomputeSelection,
  toggleVisual,
  clearSelection,
  selectLine,
  buildWordSelection,
  hasSelection,
  isCellSelected,
  isCellSelectedSync,
} from '../selection';
import type { CopyModeState } from '../types';
import type { ScrollMeta } from '../navigation/types';

const createMockState = (overrides: Partial<CopyModeState> = {}): CopyModeState => ({
  ptyId: 'test-pty',
  cursor: { x: 10, absY: 50 },
  anchor: null,
  visualType: null,
  selectionRange: null,
  bounds: null,
  ...overrides,
});

const createMockMeta = (overrides: Partial<ScrollMeta> = {}): ScrollMeta => ({
  terminalState: { rows: 24, cols: 80, cells: [] } as any,
  emulator: null,
  scrollbackLength: 100,
  rows: 24,
  cols: 80,
  viewportOffset: 0,
  ...overrides,
});

describe('buildSelection', () => {
  it('builds char selection', () => {
    const anchor = { x: 0, absY: 50 };
    const cursor = { x: 10, absY: 50 };
    const result = buildSelection(anchor, cursor, 'char', 80);
    expect(result.range.startX).toBe(0);
    expect(result.range.endX).toBe(11); // cursor.x + 1 for char mode
    expect(result.range.focusAtEnd).toBe(true);
  });

  it('builds line selection', () => {
    const anchor = { x: 5, absY: 50 };
    const cursor = { x: 10, absY: 52 };
    const result = buildSelection(anchor, cursor, 'line', 80);
    expect(result.range.startY).toBe(50);
    expect(result.range.endY).toBe(52);
    expect(result.range.startX).toBe(0); // full lines
    expect(result.range.endX).toBe(80);
  });

  it('builds block selection', () => {
    const anchor = { x: 5, absY: 50 };
    const cursor = { x: 15, absY: 55 };
    const result = buildSelection(anchor, cursor, 'block', 80);
    expect(result.bounds?.minX).toBe(5);
    expect(result.bounds?.maxX).toBe(15);
    expect(result.bounds?.minY).toBe(50);
    expect(result.bounds?.maxY).toBe(55);
  });
});

describe('recomputeSelection', () => {
  it('recomputes char selection', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'char',
    });
    const meta = createMockMeta();
    const result = recomputeSelection(state, meta);
    expect(result.selectionRange).not.toBeNull();
    expect(result.bounds).not.toBeNull();
  });

  it('clears selection when no anchor', () => {
    const state = createMockState({
      anchor: null,
      visualType: 'char',
      selectionRange: { startX: 0, startY: 50, endX: 10, endY: 50, focusAtEnd: true },
    });
    const meta = createMockMeta();
    const result = recomputeSelection(state, meta);
    expect(result.selectionRange).toBeNull();
    expect(result.bounds).toBeNull();
  });

  it('clears selection when no visual type', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: null,
    });
    const meta = createMockMeta();
    const result = recomputeSelection(state, meta);
    expect(result.selectionRange).toBeNull();
  });
});

describe('toggleVisual', () => {
  it('starts selection when not active', () => {
    const state = createMockState();
    const meta = createMockMeta();
    const result = toggleVisual(state, 'char', meta);
    expect(result.anchor).toEqual(state.cursor);
    expect(result.visualType).toBe('char');
  });

  it('clears selection when same type active', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'char',
    });
    const meta = createMockMeta();
    const result = toggleVisual(state, 'char', meta);
    expect(result.anchor).toBeNull();
    expect(result.visualType).toBeNull();
  });

  it('changes type when different type active', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'char',
    });
    const meta = createMockMeta();
    const result = toggleVisual(state, 'line', meta);
    expect(result.visualType).toBe('line');
  });
});

describe('clearSelection', () => {
  it('clears all selection state', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'char',
      selectionRange: { startX: 0, startY: 50, endX: 10, endY: 50, focusAtEnd: true },
      bounds: { minX: 0, maxX: 10, minY: 50, maxY: 50 },
    });
    const result = clearSelection(state);
    expect(result.anchor).toBeNull();
    expect(result.visualType).toBeNull();
    expect(result.selectionRange).toBeNull();
    expect(result.bounds).toBeNull();
  });
});

describe('selectLine', () => {
  it('starts line selection', () => {
    const state = createMockState();
    const meta = createMockMeta();
    const result = selectLine(state, meta);
    expect(result.visualType).toBe('line');
    expect(result.anchor).toEqual(state.cursor);
  });
});

describe('buildWordSelection', () => {
  const mockWord = {
    start: 6,
    end: 10,
    absY: 50,
    line: [
      { char: ' ' },
      { char: 'w' },
      { char: 'o' },
      { char: 'r' },
      { char: 'l' },
      { char: 'd' },
    ] as any,
  };

  it('builds inner word selection', () => {
    const result = buildWordSelection(mockWord, 'inner', (c) => c === ' ');
    expect(result).toEqual({
      anchor: { x: 6, absY: 50 },
      cursor: { x: 10, absY: 50 },
    });
  });

  it('builds around word selection with trailing space', () => {
    const wordWithTrailing = {
      start: 1, // word starts at index 1
      end: 5, // word ends at index 5
      absY: 50,
      line: [
        { char: ' ' },
        { char: 'w' },
        { char: 'o' },
        { char: 'r' },
        { char: 'l' },
        { char: 'd' },
        { char: ' ' },
        { char: ' ' },
      ] as any,
    };
    const result = buildWordSelection(wordWithTrailing, 'around', (c) => c === ' ');
    // The word is at indices 1-5, with trailing space at 6-7, so end should be 7
    expect(result?.cursor.x).toBe(7);
  });
});

describe('hasSelection', () => {
  it('returns true when selection exists for matching pty', () => {
    const state = createMockState({
      selectionRange: { startX: 0, startY: 50, endX: 10, endY: 50, focusAtEnd: true },
    });
    expect(hasSelection(state, 'test-pty')).toBe(true);
  });

  it('returns false when no selection', () => {
    const state = createMockState();
    expect(hasSelection(state, 'test-pty')).toBe(false);
  });

  it('returns false for non-matching pty', () => {
    const state = createMockState({
      selectionRange: { startX: 0, startY: 50, endX: 10, endY: 50, focusAtEnd: true },
    });
    expect(hasSelection(state, 'other-pty')).toBe(false);
  });
});

describe('isCellSelectedSync', () => {
  it('returns true for cell in block selection', () => {
    const state = createMockState({
      anchor: { x: 5, absY: 48 },
      visualType: 'block',
    });
    // Cursor is at (10, 50), anchor at (5, 48)
    // Block covers x: 5-10, y: 48-50
    expect(isCellSelectedSync(state, 'test-pty', 7, 49)).toBe(true);
  });

  it('returns false for cell outside block selection', () => {
    const state = createMockState({
      anchor: { x: 5, absY: 50 },
      visualType: 'block',
    });
    expect(isCellSelectedSync(state, 'test-pty', 20, 52)).toBe(false);
  });

  it('returns true for cell in char selection', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'char',
      selectionRange: { startX: 0, startY: 50, endX: 10, endY: 50, focusAtEnd: true },
      bounds: { minX: 0, maxX: 10, minY: 50, maxY: 50 },
    });
    expect(isCellSelectedSync(state, 'test-pty', 5, 50)).toBe(true);
  });

  it('returns false for non-matching pty', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      visualType: 'block',
    });
    expect(isCellSelectedSync(state, 'other-pty', 5, 50)).toBe(false);
  });
});

describe('isCellSelected', () => {
  it('uses full range check for char selection', () => {
    const state = createMockState({
      anchor: { x: 0, absY: 50 },
      cursor: { x: 10, absY: 50 },
      visualType: 'char',
      selectionRange: { startX: 0, startY: 50, endX: 11, endY: 50, focusAtEnd: true },
      bounds: { minX: 0, maxX: 10, minY: 50, maxY: 50 },
    });
    expect(isCellSelected(state, 'test-pty', 5, 50)).toBe(true);
    expect(isCellSelected(state, 'test-pty', 15, 50)).toBe(false);
  });
});
