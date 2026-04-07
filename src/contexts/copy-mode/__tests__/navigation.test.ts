/**
 * Navigation module comprehensive tests
 */

import { describe, it, expect } from 'bun:test';
import {
  clampCursor,
  calculateInitialCursor,
  calculateScrollForVisibility,
  getLineCellsAt,
  getLineStartX,
  getLineEndX,
} from '../navigation';
import type { ScrollMeta } from '../navigation/types';

const createMockMeta = (overrides: Partial<ScrollMeta> = {}): ScrollMeta => ({
  terminalState: { rows: 24, cols: 80, cells: [] } as any,
  emulator: {
    getScrollbackLength: () => 100,
    getScrollbackLine: (y: number) => (y === 50 ? [{ char: 's', width: 1 }] : null),
  },
  scrollbackLength: 100,
  rows: 24,
  cols: 80,
  viewportOffset: 0,
  ...overrides,
});

describe('Cursor clamping', () => {
  it('clamps x to max col - 1', () => {
    const meta = createMockMeta({ cols: 80 });
    const result = clampCursor({ x: 100, absY: 50 }, meta);
    expect(result?.x).toBe(79);
  });

  it('clamps x to 0 when negative', () => {
    const meta = createMockMeta();
    const result = clampCursor({ x: -5, absY: 50 }, meta);
    expect(result?.x).toBe(0);
  });

  it('clamps absY to valid range', () => {
    const meta = createMockMeta({ scrollbackLength: 100, rows: 24 });
    const result = clampCursor({ x: 0, absY: 200 }, meta);
    expect(result?.absY).toBe(123); // 100 + 24 - 1
  });

  it('allows valid cursor positions', () => {
    const meta = createMockMeta();
    const result = clampCursor({ x: 40, absY: 50 }, meta);
    expect(result).toEqual({ x: 40, absY: 50 });
  });
});

describe('Initial cursor calculation', () => {
  it('positions in scrollback when viewportOffset > 0', () => {
    const result = calculateInitialCursor(10, 5, 10, 100, 24, 80);
    // absY = scrollbackLength - viewportOffset = 100 - 10 = 90
    expect(result.absY).toBe(90);
    expect(result.x).toBe(10);
  });

  it('positions in live buffer when viewportOffset = 0', () => {
    const result = calculateInitialCursor(10, 5, 0, 100, 24, 80);
    // absY = scrollbackLength + cursorY = 100 + 5 = 105
    expect(result.absY).toBe(105);
  });
});

describe('Scroll visibility', () => {
  it('calculates scroll to bring cursor into view when above viewport', () => {
    const meta = createMockMeta({
      scrollbackLength: 100,
      viewportOffset: 0,
      rows: 24,
    });
    // Viewport shows 100-123, cursor at 50 (above viewport)
    const result = calculateScrollForVisibility({ x: 0, absY: 50 }, meta);
    expect(result).toBe(50); // scrollbackLength - absY
  });

  it('calculates scroll when cursor below viewport', () => {
    const meta = createMockMeta({
      scrollbackLength: 100,
      viewportOffset: 50, // showing 50-73
      rows: 24,
    });
    // Cursor at 80 (below viewport 50-73)
    const result = calculateScrollForVisibility({ x: 0, absY: 80 }, meta);
    expect(result).toBe(100 - (80 - 23)); // scrollbackLength - (absY - (rows - 1))
  });

  it('returns null when cursor already visible', () => {
    const meta = createMockMeta({
      scrollbackLength: 100,
      viewportOffset: 0, // showing 100-123
      rows: 24,
    });
    const result = calculateScrollForVisibility({ x: 0, absY: 110 }, meta);
    expect(result).toBeNull();
  });
});

describe('Line cell access', () => {
  it('gets scrollback line when absY < scrollbackLength', () => {
    const meta = createMockMeta();
    const result = getLineCellsAt(50, meta);
    expect(result).toEqual([{ char: 's', width: 1 }]);
  });

  it('gets live buffer line when absY >= scrollbackLength', () => {
    const cells = [[{ char: 'l', width: 1 }]];
    const meta = createMockMeta({
      terminalState: { rows: 24, cols: 80, cells } as any,
      scrollbackLength: 100,
    });
    // absY 100 = live row 0
    const result = getLineCellsAt(100, meta);
    expect(result).toEqual([{ char: 'l', width: 1 }]);
  });

  it('returns null for out of bounds', () => {
    const meta = createMockMeta();
    const result = getLineCellsAt(999, meta);
    expect(result).toBeNull();
  });
});

describe('Line positions', () => {
  it('gets line start (first non-blank)', () => {
    const line = [
      { char: ' ', width: 1 },
      { char: ' ', width: 1 },
      { char: 'h', width: 1 },
    ];
    const result = getLineStartX(line as any, true);
    expect(result).toBe(2);
  });

  it('gets line start (absolute 0)', () => {
    const line = [{ char: 'h', width: 1 }];
    const result = getLineStartX(line as any, false);
    expect(result).toBe(0);
  });

  it('gets line end (last non-blank)', () => {
    const line = [
      { char: 'h', width: 1 },
      { char: 'i', width: 1 },
      { char: ' ', width: 1 },
    ];
    const result = getLineEndX(line as any);
    expect(result).toBe(1);
  });

  it('handles empty line', () => {
    const result = getLineEndX(null);
    expect(result).toBe(0);
  });
});
