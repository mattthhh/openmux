/**
 * Word navigation smoke tests
 * Basic integration tests for word navigation
 */

import { describe, it, expect } from 'bun:test';
import {
  moveWordForward,
  moveWordBackward,
  moveWordEnd,
  moveWideWordForward,
  moveWideWordBackward,
} from '../navigation/word';
import type { CopyCursor } from '../types';
import type { LineAccessor } from '../text-utils';

const createMockLine = (text: string): any[] =>
  text.split('').map((char) => ({ char, width: 1 }));

const createMockAccessor = (lines: Record<number, string>): LineAccessor => ({
  maxAbsY: Math.max(...Object.keys(lines).map(Number)),
  getLine: (absY: number) => {
    const line = lines[absY];
    return line ? createMockLine(line) : null;
  },
});

describe('moveWordForward', () => {
  it('moves to next word start on same line', () => {
    const access = createMockAccessor({ 0: 'hello world test' });
    const cursor: CopyCursor = { x: 0, absY: 0 };
    const result = moveWordForward(access, cursor);
    expect(result).toEqual({ x: 6, absY: 0 }); // start of 'world'
  });

  it('moves to next line when no more words', () => {
    const access = createMockAccessor({
      0: 'hello',
      1: 'world',
    });
    const cursor: CopyCursor = { x: 0, absY: 0 };
    const result = moveWordForward(access, cursor);
    expect(result).toEqual({ x: 0, absY: 1 }); // start of 'world'
  });

  it('returns null at end of buffer', () => {
    const access = createMockAccessor({ 0: 'hello' });
    const cursor: CopyCursor = { x: 0, absY: 0 };
    const result = moveWordForward(access, cursor);
    expect(result).toBeNull(); // no more words
  });
});

describe('moveWordBackward', () => {
  it('moves to previous word start on same line', () => {
    const access = createMockAccessor({ 0: 'hello world test' });
    const cursor: CopyCursor = { x: 12, absY: 0 }; // at 'test'
    const result = moveWordBackward(access, cursor);
    expect(result).toEqual({ x: 6, absY: 0 }); // start of 'world'
  });

  it('moves to previous line when no earlier words', () => {
    const access = createMockAccessor({
      0: 'hello',
      1: 'world',
    });
    const cursor: CopyCursor = { x: 0, absY: 1 };
    const result = moveWordBackward(access, cursor);
    expect(result).toEqual({ x: 0, absY: 0 }); // start of 'hello'
  });
});

describe('moveWordEnd', () => {
  it('moves to current word end if not at end', () => {
    const access = createMockAccessor({ 0: 'hello world' });
    const cursor: CopyCursor = { x: 1, absY: 0 }; // inside 'hello'
    const result = moveWordEnd(access, cursor);
    expect(result).toEqual({ x: 4, absY: 0 }); // end of 'hello'
  });

  it('moves to next word end if at current word end', () => {
    const access = createMockAccessor({ 0: 'hello world' });
    const cursor: CopyCursor = { x: 4, absY: 0 }; // end of 'hello'
    const result = moveWordEnd(access, cursor);
    expect(result).toEqual({ x: 10, absY: 0 }); // end of 'world'
  });
});

describe('moveWideWordForward (WORD motion)', () => {
  it('returns null when no more WORDs', () => {
    const access = createMockAccessor({ 0: 'hello-world_test' });
    const cursor: CopyCursor = { x: 0, absY: 0 };
    const result = moveWideWordForward(access, cursor);
    // Since current char is wide word char and no whitespace,
    // it tries to find next WORD which doesn't exist
    expect(result).toBeNull();
  });

  it('stops at whitespace boundaries', () => {
    const access = createMockAccessor({ 0: 'hello world  next' });
    const cursor: CopyCursor = { x: 0, absY: 0 };
    const result = moveWideWordForward(access, cursor);
    expect(result).toEqual({ x: 6, absY: 0 }); // start of 'world'
  });
});

describe('moveWideWordBackward (WORD motion)', () => {
  it('moves to previous WORD start', () => {
    const access = createMockAccessor({ 0: 'hello-world_test more' });
    const cursor: CopyCursor = { x: 15, absY: 0 }; // at 'more'
    const result = moveWideWordBackward(access, cursor);
    // Should go to start of 'hello-world_test'
    expect(result?.absY).toBe(0);
    expect(result?.x).toBe(0);
  });
});
