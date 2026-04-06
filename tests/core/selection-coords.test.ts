import { describe, it, expect } from 'bun:test';
import type { TerminalCell } from '../../src/core/types';
import {
  extractSelectedText,
  isCellInRange,
  type SelectionRange,
} from '../../src/core/coordinates/selection-coords';

function createCell(char: string, width: 1 | 2 = 1): TerminalCell {
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
    width,
  };
}

function createLine(text: string): TerminalCell[] {
  return text.split('').map((char) => createCell(char));
}

describe('selection coordinates', () => {
  it('excludes the focus cell at the end of a forward single-line selection', () => {
    const range: SelectionRange = {
      startX: 1,
      startY: 10,
      endX: 4,
      endY: 10,
      focusAtEnd: true,
    };

    expect(isCellInRange(1, 10, range)).toBe(true);
    expect(isCellInRange(3, 10, range)).toBe(true);
    expect(isCellInRange(4, 10, range)).toBe(false);
  });

  it('excludes the focus cell at the start of a backward multi-line selection', () => {
    const range: SelectionRange = {
      startX: 2,
      startY: 10,
      endX: 3,
      endY: 12,
      focusAtEnd: false,
    };

    expect(isCellInRange(2, 10, range)).toBe(false);
    expect(isCellInRange(3, 10, range)).toBe(true);
    expect(isCellInRange(1, 11, range)).toBe(true);
    expect(isCellInRange(3, 12, range)).toBe(true);
    expect(isCellInRange(4, 12, range)).toBe(false);
  });

  it('extracts text with Zellij-style focus exclusion across multiple rows', () => {
    const range: SelectionRange = {
      startX: 2,
      startY: 10,
      endX: 2,
      endY: 11,
      focusAtEnd: false,
    };
    const lines = {
      10: createLine('01234'),
      11: createLine('abcde'),
    };

    const text = extractSelectedText(range, 0, (absoluteY) => lines[absoluteY as 10 | 11] ?? null);

    expect(text).toBe('34\nabc');
  });

  it('skips wide-character placeholder cells during extraction', () => {
    const wideLine: TerminalCell[] = [
      createCell('A'),
      createCell('宽', 2),
      createCell(''),
      createCell('B'),
    ];
    const range: SelectionRange = {
      startX: 0,
      startY: 5,
      endX: 4,
      endY: 5,
      focusAtEnd: true,
    };

    const text = extractSelectedText(range, 0, () => wideLine);

    expect(text).toBe('A宽B');
  });
});
