/**
 * Text extraction module comprehensive tests
 */

import { describe, it, expect } from 'bun:test';
import {
  createLineAccessor,
  extractBlockText,
  extractRangeText,
  extractLineAtCursor,
  prepareCopyText,
  TextExtractionError,
} from '../text';
import type { CopyCursor } from '../types';
import type { SelectionRange } from '../../../core/coordinates';

describe('createLineAccessor', () => {
  it('creates accessor with correct maxAbsY', () => {
    const getLine = (_absY: number) => [{ char: 'a', width: 1 }] as any;
    const accessor = createLineAccessor('test-pty', getLine, 100);
    expect(accessor.maxAbsY).toBe(100);
  });
});

describe('extractBlockText', () => {
  const createGetLine = (lines: Record<number, string>) => (absY: number) => {
    const text = lines[absY];
    return text ? text.split('').map((c) => ({ char: c, width: 1 })) : null;
  };

  it('extracts rectangular block', () => {
    const anchor: CopyCursor = { x: 2, absY: 50 };
    const cursor: CopyCursor = { x: 5, absY: 52 };
    const getLine = createGetLine({
      50: 'hello world',
      51: 'foo bar baz',
      52: 'test line here',
    });

    const result = extractBlockText(anchor, cursor, getLine);
    // x: 2-5 means columns 2,3,4,5 (4 chars)
    // Line 50: 'hello world'  -> indices 2-5: 'llo '
    // Line 51: 'foo bar baz'  -> indices 2-5: 'o ba'
    // Line 52: 'test line here' -> indices 2-5: 'st l'
    expect(result).toBe('llo \no ba\nst l');
  });

  it('handles reversed anchor/cursor', () => {
    const anchor: CopyCursor = { x: 5, absY: 52 };
    const cursor: CopyCursor = { x: 2, absY: 50 };
    const getLine = createGetLine({
      50: 'hello world',
      51: 'skipped',
      52: 'test line here',
    });

    const result = extractBlockText(anchor, cursor, getLine);
    // minX=2, maxX=5, minY=50, maxY=52
    expect(result).toContain('llo ');
  });

  it('pads missing cells with spaces', () => {
    const anchor: CopyCursor = { x: 8, absY: 50 };
    const cursor: CopyCursor = { x: 12, absY: 50 };
    const getLine = createGetLine({ 50: 'short' });

    const result = extractBlockText(anchor, cursor, getLine);
    expect(result).toBe('     '); // 5 spaces for missing cells
  });

  it('skips placeholder cells for wide chars', () => {
    const anchor: CopyCursor = { x: 0, absY: 50 };
    const cursor: CopyCursor = { x: 3, absY: 50 };
    const getLine = () =>
      [
        { char: '宽', width: 2 },
        { char: '', width: 0 }, // placeholder
        { char: 'a', width: 1 },
        { char: 'b', width: 1 },
      ] as any;

    const result = extractBlockText(anchor, cursor, getLine);
    expect(result).toBe('宽ab');
  });
});

describe('extractRangeText', () => {
  const createGetLine = (lines: Record<number, string>) => (absY: number) => {
    const text = lines[absY];
    return text ? text.split('').map((c) => ({ char: c, width: 1 })) : null;
  };

  it('extracts single line range', () => {
    const range: SelectionRange = {
      startX: 0,
      startY: 50,
      endX: 5,
      endY: 50,
      focusAtEnd: true,
    };
    const getLine = createGetLine({ 50: 'hello world' });

    const result = extractRangeText(range, 100, getLine);
    expect(result).toBe('hello');
  });

  it('extracts multi-line range', () => {
    const range: SelectionRange = {
      startX: 6,
      startY: 50,
      endX: 4, // endX is exclusive
      endY: 52,
      focusAtEnd: true,
    };
    const getLine = createGetLine({
      50: 'hello world',
      51: 'foo bar',
      52: 'test line',
    });

    const result = extractRangeText(range, 100, getLine);
    // Start at col 6 on line 50: 'world'
    // Middle line 51: full 'foo bar'
    // End at col 3 on line 52: 'tes' (0-3 exclusive of focus at end)
    expect(result).toContain('world');
    expect(result).toContain('foo bar');
  });

  it('returns error for invalid extraction', () => {
    const range: SelectionRange = {
      startX: 0,
      startY: 50,
      endX: 5,
      endY: 50,
      focusAtEnd: true,
    };
    const getLine = () => {
      throw new Error('Line access error');
    };

    const result = extractRangeText(range, 100, getLine);
    expect(result).toBeInstanceOf(TextExtractionError);
  });
});

describe('extractLineAtCursor', () => {
  const createGetLine = (lines: Record<number, string>) => (absY: number) => {
    const text = lines[absY];
    return text ? text.split('').map((c) => ({ char: c, width: 1 })) : null;
  };

  it('extracts entire line', () => {
    const cursor: CopyCursor = { x: 5, absY: 50 };
    const getLine = createGetLine({ 50: 'hello world' });

    const result = extractLineAtCursor(cursor, 80, getLine);
    expect(result).toBe('hello world');
  });

  it('extracts up to cols limit', () => {
    const cursor: CopyCursor = { x: 0, absY: 50 };
    const getLine = createGetLine({ 50: 'hello world this is long' });

    const result = extractLineAtCursor(cursor, 11, getLine);
    expect(result).toBe('hello world');
  });
});

describe('prepareCopyText', () => {
  it('returns result for non-empty text', () => {
    const result = prepareCopyText('hello');
    expect(result).toEqual({ text: 'hello', length: 5 });
  });

  it('returns null for empty text', () => {
    const result = prepareCopyText('');
    expect(result).toBeNull();
  });
});

describe('TextExtractionError', () => {
  it('creates error with reason', () => {
    const error = new TextExtractionError({ reason: 'Test failure' });
    expect(error.message).toContain('Test failure');
    expect(error._tag).toBe('TextExtractionError');
  });
});
