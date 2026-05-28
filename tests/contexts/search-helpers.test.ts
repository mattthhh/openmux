/**
 * Tests for search helper functions
 */
import { describe, it, expect } from 'bun:test';
import type { TerminalCell } from '../../src/core/types';
import type { SearchMatch } from '../../src/contexts/search/types';
import {
  SEARCH_OVERLAY_HEIGHT,
  extractLineText,
  isCellInMatch,
  calculateScrollOffset,
  buildMatchLookup,
} from '../../src/contexts/search/helpers';

// Helper to create a mock terminal cell
function createCell(char: string, width: 1 | 2 = 1): TerminalCell {
  return {
    char,
    width,
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
  };
}

// Helper to create a row of cells from a string
function createCells(text: string): TerminalCell[] {
  return text.split('').map((char) => createCell(char));
}

describe('extractLineText', () => {
  it('extracts text from simple cells', () => {
    const cells = createCells('hello world');
    expect(extractLineText(cells)).toBe('hello world');
  });

  it('returns empty string for empty array', () => {
    expect(extractLineText([])).toBe('');
  });

  it('handles single character', () => {
    const cells = [createCell('x')];
    expect(extractLineText(cells)).toBe('x');
  });

  it('skips placeholder cells for wide characters', () => {
    // Wide character like '日' takes 2 cells: the char itself (width=2) + placeholder
    const cells: TerminalCell[] = [
      createCell('日', 2),
      createCell(' ', 1), // placeholder after wide char (skipped)
      createCell('本', 2),
      createCell(' ', 1), // placeholder after wide char (skipped)
    ];
    // Should extract '日本' - placeholders are skipped when previous char has width=2
    expect(extractLineText(cells)).toBe('日本');
  });

  it('handles mixed normal and wide characters', () => {
    const cells: TerminalCell[] = [
      createCell('a'),
      createCell('日', 2),
      createCell(' '), // placeholder (skipped)
      createCell('b'),
    ];
    // 'a' + '日' (skip placeholder) + 'b' = 'a日b'
    expect(extractLineText(cells)).toBe('a日b');
  });

  it('preserves whitespace', () => {
    const cells = createCells('  hello  ');
    expect(extractLineText(cells)).toBe('  hello  ');
  });

  it('handles special characters', () => {
    const cells = createCells('foo\tbar\n');
    expect(extractLineText(cells)).toBe('foo\tbar\n');
  });
});

describe('isCellInMatch', () => {
  const match: SearchMatch = {
    lineIndex: 5,
    startCol: 10,
    endCol: 15, // exclusive
  };

  it('returns true for cell inside match', () => {
    expect(isCellInMatch(10, 5, match)).toBe(true);
    expect(isCellInMatch(12, 5, match)).toBe(true);
    expect(isCellInMatch(14, 5, match)).toBe(true);
  });

  it('returns false for cell at endCol (exclusive)', () => {
    expect(isCellInMatch(15, 5, match)).toBe(false);
  });

  it('returns false for cell before startCol', () => {
    expect(isCellInMatch(9, 5, match)).toBe(false);
    expect(isCellInMatch(0, 5, match)).toBe(false);
  });

  it('returns false for cell after endCol', () => {
    expect(isCellInMatch(16, 5, match)).toBe(false);
    expect(isCellInMatch(100, 5, match)).toBe(false);
  });

  it('returns false for different line', () => {
    expect(isCellInMatch(12, 4, match)).toBe(false);
    expect(isCellInMatch(12, 6, match)).toBe(false);
    expect(isCellInMatch(12, 0, match)).toBe(false);
  });

  it('handles match at start of line', () => {
    const startMatch: SearchMatch = { lineIndex: 0, startCol: 0, endCol: 5 };
    expect(isCellInMatch(0, 0, startMatch)).toBe(true);
    expect(isCellInMatch(4, 0, startMatch)).toBe(true);
    expect(isCellInMatch(5, 0, startMatch)).toBe(false);
  });

  it('handles single character match', () => {
    const singleMatch: SearchMatch = { lineIndex: 3, startCol: 7, endCol: 8 };
    expect(isCellInMatch(7, 3, singleMatch)).toBe(true);
    expect(isCellInMatch(6, 3, singleMatch)).toBe(false);
    expect(isCellInMatch(8, 3, singleMatch)).toBe(false);
  });
});

describe('calculateScrollOffset', () => {
  // With SEARCH_OVERLAY_HEIGHT = 5 and terminalRows = 24
  // effectiveRows = 24 - 5 = 19
  // centerPoint = floor(19 / 2) = 9

  it('centers a line in the middle of scrollback', () => {
    const scrollbackLength = 100;
    const terminalRows = 24;
    const lineIndex = 50;

    const offset = calculateScrollOffset(lineIndex, scrollbackLength, terminalRows);

    // targetOffset = 100 - 50 + 9 = 59
    expect(offset).toBe(59);
  });

  it('clamps to 0 when line is near bottom', () => {
    const scrollbackLength = 100;
    const terminalRows = 24;
    const lineIndex = 105; // Beyond scrollback, in visible area

    const offset = calculateScrollOffset(lineIndex, scrollbackLength, terminalRows);

    // targetOffset = 100 - 105 + 9 = 4, but clamped to 0
    expect(offset).toBe(4);
  });

  it('clamps to scrollbackLength when line is at top', () => {
    const scrollbackLength = 100;
    const terminalRows = 24;
    const lineIndex = 0; // Oldest line

    const offset = calculateScrollOffset(lineIndex, scrollbackLength, terminalRows);

    // targetOffset = 100 - 0 + 9 = 109, clamped to 100
    expect(offset).toBe(100);
  });

  it('returns 0 when scrollbackLength is 0', () => {
    const offset = calculateScrollOffset(5, 0, 24);
    // targetOffset = 0 - 5 + 9 = 4, but clamped to max(0, min(4, 0)) = 0
    expect(offset).toBe(0);
  });

  it('handles small terminal', () => {
    const scrollbackLength = 50;
    const terminalRows = 10; // effectiveRows = 5, centerPoint = 2
    const lineIndex = 25;

    const offset = calculateScrollOffset(lineIndex, scrollbackLength, terminalRows);

    // targetOffset = 50 - 25 + 2 = 27
    expect(offset).toBe(27);
  });

  it('accounts for SEARCH_OVERLAY_HEIGHT', () => {
    // Verify the constant is used correctly
    expect(SEARCH_OVERLAY_HEIGHT).toBe(5);

    const scrollbackLength = 100;
    const terminalRows = 24;
    const lineIndex = 50;

    // With overlay: effectiveRows = 19, centerPoint = 9
    // targetOffset = 100 - 50 + 9 = 59
    const offset = calculateScrollOffset(lineIndex, scrollbackLength, terminalRows);
    expect(offset).toBe(59);
  });
});

describe('buildMatchLookup', () => {
  it('returns empty map for no matches', () => {
    const lookup = buildMatchLookup([]);
    expect(lookup.size).toBe(0);
  });

  it('creates lookup for single match', () => {
    const matches: SearchMatch[] = [{ lineIndex: 5, startCol: 10, endCol: 15 }];

    const lookup = buildMatchLookup(matches);

    expect(lookup.size).toBe(1);
    expect(lookup.get(5)).toEqual([{ startCol: 10, endCol: 15 }]);
  });

  it('groups multiple matches on same line', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 5, startCol: 0, endCol: 5 },
      { lineIndex: 5, startCol: 10, endCol: 15 },
      { lineIndex: 5, startCol: 20, endCol: 25 },
    ];

    const lookup = buildMatchLookup(matches);

    expect(lookup.size).toBe(1);
    expect(lookup.get(5)).toEqual([
      { startCol: 0, endCol: 5 },
      { startCol: 10, endCol: 15 },
      { startCol: 20, endCol: 25 },
    ]);
  });

  it('handles matches across multiple lines', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 1, startCol: 0, endCol: 5 },
      { lineIndex: 3, startCol: 10, endCol: 15 },
      { lineIndex: 5, startCol: 20, endCol: 25 },
    ];

    const lookup = buildMatchLookup(matches);

    expect(lookup.size).toBe(3);
    expect(lookup.get(1)).toEqual([{ startCol: 0, endCol: 5 }]);
    expect(lookup.get(3)).toEqual([{ startCol: 10, endCol: 15 }]);
    expect(lookup.get(5)).toEqual([{ startCol: 20, endCol: 25 }]);
  });

  it('handles mixed single and multiple matches per line', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 1, startCol: 0, endCol: 5 },
      { lineIndex: 2, startCol: 0, endCol: 3 },
      { lineIndex: 2, startCol: 10, endCol: 13 },
      { lineIndex: 3, startCol: 5, endCol: 10 },
    ];

    const lookup = buildMatchLookup(matches);

    expect(lookup.size).toBe(3);
    expect(lookup.get(1)).toEqual([{ startCol: 0, endCol: 5 }]);
    expect(lookup.get(2)).toEqual([
      { startCol: 0, endCol: 3 },
      { startCol: 10, endCol: 13 },
    ]);
    expect(lookup.get(3)).toEqual([{ startCol: 5, endCol: 10 }]);
  });

  it('preserves match order within a line', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startCol: 20, endCol: 25 },
      { lineIndex: 0, startCol: 5, endCol: 10 },
      { lineIndex: 0, startCol: 30, endCol: 35 },
    ];

    const lookup = buildMatchLookup(matches);

    // Should preserve insertion order
    expect(lookup.get(0)).toEqual([
      { startCol: 20, endCol: 25 },
      { startCol: 5, endCol: 10 },
      { startCol: 30, endCol: 35 },
    ]);
  });

  it('returns undefined for non-existent line', () => {
    const matches: SearchMatch[] = [{ lineIndex: 5, startCol: 0, endCol: 5 }];

    const lookup = buildMatchLookup(matches);

    expect(lookup.get(0)).toBeUndefined();
    expect(lookup.get(10)).toBeUndefined();
  });
});
