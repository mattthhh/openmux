/**
 * Word navigation functions for copy mode
 */

import type { CopyCursor } from '../types';
import type { TerminalCell } from '../../../core/types';
import type { LineAccessor } from '../text-utils';
import {
  getRunAt,
  findNextRun,
  findPrevRun,
  findSpanAtOrAfter,
  findSpanAtOrBefore,
  isWideWordChar,
} from '../text-utils';

/** Result of word navigation */
export interface WordNavResult {
  x: number;
  absY: number;
}

/** Move to next word start (w motion) */
export const moveWordForward = (access: LineAccessor, cursor: CopyCursor): WordNavResult | null => {
  const run = getRunAt(access, cursor.absY, cursor.x);
  const searchAbsY = run ? run.absY : cursor.absY;
  const searchX = run ? run.end + 1 : cursor.x;
  const next = findNextRun(access, searchAbsY, searchX);
  return next ? { x: next.start, absY: next.absY } : null;
};

/** Move to previous word start (b motion) */
export const moveWordBackward = (
  access: LineAccessor,
  cursor: CopyCursor
): WordNavResult | null => {
  const run = getRunAt(access, cursor.absY, cursor.x);
  if (run && cursor.x > run.start) {
    return { x: run.start, absY: run.absY };
  }
  const searchAbsY = run ? run.absY : cursor.absY;
  const searchX = run ? run.start - 1 : cursor.x - 1;
  const prev = findPrevRun(access, searchAbsY, searchX);
  return prev ? { x: prev.start, absY: prev.absY } : null;
};

/** Move to next word end (e motion) */
export const moveWordEnd = (access: LineAccessor, cursor: CopyCursor): WordNavResult | null => {
  const run = getRunAt(access, cursor.absY, cursor.x);
  if (run && cursor.x < run.end) {
    return { x: run.end, absY: run.absY };
  }
  const searchAbsY = run ? run.absY : cursor.absY;
  const searchX = run ? run.end + 1 : cursor.x;
  const next = findNextRun(access, searchAbsY, searchX);
  return next ? { x: next.end, absY: next.absY } : null;
};

/** Move to next WORD start (W motion - whitespace delimited) */
export const moveWideWordForward = (
  access: LineAccessor,
  cursor: CopyCursor
): WordNavResult | null => {
  const line = access.getLine(cursor.absY);
  const currentChar = line?.[cursor.x]?.char ?? ' ';
  const word = findSpanAtOrAfter(access, cursor.absY, cursor.x, isWideWordChar);
  if (!word) return null;

  if (isWideWordChar(currentChar) && word.absY === cursor.absY && cursor.x <= word.end) {
    const next = findSpanAtOrAfter(access, word.absY, word.end + 1, isWideWordChar);
    return next ? { x: next.start, absY: next.absY } : null;
  }

  return { x: word.start, absY: word.absY };
};

/** Move to previous WORD start (B motion) */
export const moveWideWordBackward = (
  access: LineAccessor,
  cursor: CopyCursor
): WordNavResult | null => {
  const line = access.getLine(cursor.absY);
  const currentChar = line?.[cursor.x]?.char ?? ' ';
  const word = findSpanAtOrBefore(access, cursor.absY, cursor.x, isWideWordChar);
  if (!word) return null;

  if (isWideWordChar(currentChar) && word.absY === cursor.absY && cursor.x === word.start) {
    const prev = findSpanAtOrBefore(access, word.absY, word.start - 1, isWideWordChar);
    return prev ? { x: prev.start, absY: prev.absY } : null;
  }

  return { x: word.start, absY: word.absY };
};

/** Move to next WORD end (E motion) */
export const moveWideWordEnd = (access: LineAccessor, cursor: CopyCursor): WordNavResult | null => {
  const line = access.getLine(cursor.absY);
  const currentChar = line?.[cursor.x]?.char ?? ' ';
  const word = findSpanAtOrAfter(access, cursor.absY, cursor.x, isWideWordChar);
  if (!word) return null;

  if (isWideWordChar(currentChar) && word.absY === cursor.absY && cursor.x <= word.end) {
    if (cursor.x < word.end) {
      return { x: word.end, absY: word.absY };
    }
    const next = findSpanAtOrAfter(access, word.absY, word.end + 1, isWideWordChar);
    return next ? { x: next.end, absY: next.absY } : null;
  }

  return { x: word.end, absY: word.absY };
};

/** Get line start X (first non-blank for ^ motion, 0 for 0 motion) */
export const getLineStartX = (line: TerminalCell[] | null, firstNonBlank: boolean): number => {
  if (!line || line.length === 0) return 0;

  if (!firstNonBlank) return 0;

  for (let x = 0; x < line.length; x += 1) {
    const cell = line[x];
    const char = cell?.char ?? ' ';
    if (char.trim().length > 0) {
      return x;
    }
  }
  return 0;
};

/** Get line end X ($ motion) */
export const getLineEndX = (line: TerminalCell[] | null): number => {
  if (!line || line.length === 0) return 0;
  for (let x = line.length - 1; x >= 0; x -= 1) {
    const cell = line[x];
    const char = cell?.char ?? ' ';
    if (char.trim().length > 0) {
      return x;
    }
  }
  return 0;
};
