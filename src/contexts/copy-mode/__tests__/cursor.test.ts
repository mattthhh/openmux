/**
 * Cursor clamping litmus tests
 * Fast, single-concept tests
 */

import { describe, it, expect } from 'bun:test';
import { clampCursor, calculateInitialCursor, moveCursorBy } from '../navigation/cursor';
import type { CopyCursor } from '../types';
import type { ScrollMeta } from '../navigation/types';

const createMockMeta = (overrides: Partial<ScrollMeta> = {}): ScrollMeta => ({
  terminalState: { rows: 24, cols: 80, cells: [] } as any,
  emulator: null,
  scrollbackLength: 100,
  rows: 24,
  cols: 80,
  viewportOffset: 0,
  ...overrides,
});

describe('clampCursor', () => {
  it('clamps x to valid range', () => {
    const meta = createMockMeta({ cols: 80 });
    const cursor: CopyCursor = { x: 100, absY: 50 };
    const result = clampCursor(cursor, meta);
    expect(result).toEqual({ x: 79, absY: 50 });
  });

  it('clamps negative x to 0', () => {
    const meta = createMockMeta();
    const cursor: CopyCursor = { x: -5, absY: 50 };
    const result = clampCursor(cursor, meta);
    expect(result).toEqual({ x: 0, absY: 50 });
  });

  it('clamps absY to max valid', () => {
    const meta = createMockMeta({ scrollbackLength: 100, rows: 24 });
    const cursor: CopyCursor = { x: 10, absY: 200 };
    const result = clampCursor(cursor, meta);
    expect(result?.absY).toBe(123); // 100 + 24 - 1
  });

  it('returns null for invalid terminal state', () => {
    const meta = createMockMeta({ terminalState: null });
    const cursor: CopyCursor = { x: 10, absY: 50 };
    const result = clampCursor(cursor, meta);
    expect(result).toBeNull();
  });

  it('returns null for zero rows', () => {
    const meta = createMockMeta({ rows: 0 });
    const cursor: CopyCursor = { x: 10, absY: 50 };
    const result = clampCursor(cursor, meta);
    expect(result).toBeNull();
  });
});

describe('calculateInitialCursor', () => {
  it('calculates correct absY in scrollback', () => {
    const result = calculateInitialCursor(5, 10, 5, 100, 24, 80);
    expect(result).toEqual({ x: 5, absY: 95 }); // 100 - 5
  });

  it('calculates correct absY in live buffer', () => {
    const result = calculateInitialCursor(5, 10, 0, 100, 24, 80);
    expect(result).toEqual({ x: 5, absY: 110 }); // 100 + 10
  });

  it('clamps x to valid range', () => {
    const result = calculateInitialCursor(100, 0, 0, 0, 24, 80);
    expect(result.x).toBe(79);
  });

  it('calculates absY for cursor at row 0', () => {
    // When cursorY is 0 and viewportOffset is 0, absY = scrollbackLength + 0 = 100
    const result = calculateInitialCursor(0, 0, 0, 100, 24, 80);
    expect(result.absY).toBe(100);
  });
});

describe('moveCursorBy', () => {
  it('adds delta to cursor position', () => {
    const cursor: CopyCursor = { x: 10, absY: 50 };
    const result = moveCursorBy(cursor, 5, 10);
    expect(result).toEqual({ x: 15, absY: 60 });
  });

  it('handles negative deltas', () => {
    const cursor: CopyCursor = { x: 10, absY: 50 };
    const result = moveCursorBy(cursor, -5, -10);
    expect(result).toEqual({ x: 5, absY: 40 });
  });
});
