/**
 * Text extraction utilities for copy mode
 */

import type { TerminalCell } from '../../../core/types';
import type { CopyCursor } from '../types';
import type { LineAccessor } from '../text-utils';
import { extractSelectedText, type SelectionRange } from '../../../core/coordinates';
import * as errore from 'errore';

/** Error for text extraction failures */
export class TextExtractionError extends errore.createTaggedError({
  name: 'TextExtractionError',
  message: 'Failed to extract text: $reason',
}) {}

/** Get a line accessor for the active terminal */
export const createLineAccessor = (
  ptyId: string,
  getLine: (absY: number) => TerminalCell[] | null,
  maxAbsY: number
): LineAccessor => ({
  maxAbsY,
  getLine,
});

/** Extract text from block selection */
export const extractBlockText = (
  anchor: CopyCursor,
  cursor: CopyCursor,
  getLine: (absY: number) => TerminalCell[] | null
): string => {
  const minX = Math.min(anchor.x, cursor.x);
  const maxX = Math.max(anchor.x, cursor.x);
  const minY = Math.min(anchor.absY, cursor.absY);
  const maxY = Math.max(anchor.absY, cursor.absY);

  const lines: string[] = [];

  for (let absY = minY; absY <= maxY; absY += 1) {
    const row = getLine(absY);
    let rowText = '';

    for (let x = minX; x <= maxX; x += 1) {
      const cell = row?.[x];
      if (!cell) {
        rowText += ' ';
        continue;
      }
      rowText += cell.char;
      if (cell.width === 2) {
        x += 1;
      }
    }
    lines.push(rowText);
  }

  return lines.join('\n');
};

/** Extract text from range selection (char or line mode) */
export const extractRangeText = (
  range: SelectionRange,
  scrollbackLength: number,
  getLine: (absY: number) => TerminalCell[] | null
): string | TextExtractionError => {
  const result = errore.try({
    try: () => extractSelectedText(range, scrollbackLength, getLine),
    catch: (e) =>
      new TextExtractionError({
        reason: `Extraction failed: ${String(e)}`,
      }),
  });

  if (result instanceof TextExtractionError) {
    return result;
  }

  return result;
};

/** Extract entire line at cursor */
export const extractLineAtCursor = (
  cursor: CopyCursor,
  cols: number,
  getLine: (absY: number) => TerminalCell[] | null
): string => {
  const range: SelectionRange = {
    startX: 0,
    startY: cursor.absY,
    endX: Math.max(1, cols),
    endY: cursor.absY,
    focusAtEnd: true,
  };

  return extractSelectedText(range, 0, getLine);
};

/** Copy text to clipboard with notification */
export interface CopyResult {
  text: string;
  length: number;
}

/** Prepare text for clipboard copying */
export const prepareCopyText = (
  text: string
): CopyResult | null => {
  if (text.length === 0) return null;
  return { text, length: text.length };
};
