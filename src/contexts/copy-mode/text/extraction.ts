/**
 * Text extraction utilities for copy mode
 */

import type { TerminalCell } from '../../../core/types';
import type { CopyCursor } from '../types';
import type { LineAccessor } from '../text-utils';
import { extractSelectedText, type SelectionRange } from '../../../core/coordinates';
import * as errore from 'errore';

const EXTRACTION_CHUNK_LINES = 512;

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

function renderRowText(
  row: TerminalCell[] | null,
  startX: number,
  endX: number,
  options?: { padMissing?: boolean }
): string {
  const boundedEndX = Number.isFinite(endX) ? endX : Math.max(-1, (row?.length ?? 0) - 1);
  if (startX > boundedEndX) return '';

  let rowText = '';
  for (let x = Math.max(0, startX); x <= boundedEndX; x += 1) {
    const cell = row?.[x];
    if (!cell) {
      if (options?.padMissing) {
        rowText += ' ';
      }
      continue;
    }

    rowText += cell.char;
    if (cell.width === 2) {
      x += 1;
    }
  }

  return rowText.trimEnd();
}

function getRangeRowBounds(
  range: SelectionRange,
  absY: number
): { startX: number; endX: number } | null {
  const { startX, startY, endX, endY, focusAtEnd } = range;

  if (absY < startY || absY > endY) {
    return null;
  }

  if (startY === endY) {
    return focusAtEnd ? { startX, endX: endX - 1 } : { startX: startX + 1, endX };
  }

  if (absY === startY) {
    return {
      startX: focusAtEnd ? startX : startX + 1,
      endX: Number.POSITIVE_INFINITY,
    };
  }

  if (absY === endY) {
    return {
      startX: 0,
      endX: focusAtEnd ? endX - 1 : endX,
    };
  }

  return {
    startX: 0,
    endX: Number.POSITIVE_INFINITY,
  };
}

async function fetchScrollbackChunk(options: {
  scrollbackLength: number;
  chunkStartY: number;
  chunkEndY: number;
  fetchScrollbackLines: (
    startOffset: number,
    count: number
  ) => Promise<Map<number, TerminalCell[]>>;
}): Promise<Map<number, TerminalCell[]> | TextExtractionError> {
  const scrollStart = Math.max(0, options.chunkStartY);
  const scrollEnd = Math.min(options.scrollbackLength - 1, options.chunkEndY);
  if (scrollStart > scrollEnd) {
    return new Map<number, TerminalCell[]>();
  }

  const result = await options
    .fetchScrollbackLines(scrollStart, scrollEnd - scrollStart + 1)
    .catch(
      (e) => new TextExtractionError({ reason: `Scrollback fetch failed: ${String(e)}`, cause: e })
    );
  if (result instanceof TextExtractionError) {
    return result;
  }

  return result;
}

export async function extractBlockTextByChunks(options: {
  anchor: CopyCursor;
  cursor: CopyCursor;
  scrollbackLength: number;
  fetchScrollbackLines: (
    startOffset: number,
    count: number
  ) => Promise<Map<number, TerminalCell[]>>;
  getLiveLine: (absY: number) => TerminalCell[] | null;
}): Promise<string | TextExtractionError> {
  const minX = Math.min(options.anchor.x, options.cursor.x);
  const maxX = Math.max(options.anchor.x, options.cursor.x);
  const minY = Math.min(options.anchor.absY, options.cursor.absY);
  const maxY = Math.max(options.anchor.absY, options.cursor.absY);
  const lines: string[] = [];

  for (let chunkStartY = minY; chunkStartY <= maxY; chunkStartY += EXTRACTION_CHUNK_LINES) {
    const chunkEndY = Math.min(maxY, chunkStartY + EXTRACTION_CHUNK_LINES - 1);
    const scrollbackChunk = await fetchScrollbackChunk({
      scrollbackLength: options.scrollbackLength,
      chunkStartY,
      chunkEndY,
      fetchScrollbackLines: options.fetchScrollbackLines,
    });
    if (scrollbackChunk instanceof TextExtractionError) {
      return scrollbackChunk;
    }

    for (let absY = chunkStartY; absY <= chunkEndY; absY += 1) {
      const row =
        absY < options.scrollbackLength
          ? (scrollbackChunk.get(absY) ?? null)
          : options.getLiveLine(absY);
      lines.push(renderRowText(row, minX, maxX, { padMissing: true }));
    }
  }

  return lines.join('\n');
}

export async function extractRangeTextByChunks(options: {
  range: SelectionRange;
  scrollbackLength: number;
  fetchScrollbackLines: (
    startOffset: number,
    count: number
  ) => Promise<Map<number, TerminalCell[]>>;
  getLiveLine: (absY: number) => TerminalCell[] | null;
}): Promise<string | TextExtractionError> {
  const { range } = options;
  const lines: string[] = [];

  for (
    let chunkStartY = range.startY;
    chunkStartY <= range.endY;
    chunkStartY += EXTRACTION_CHUNK_LINES
  ) {
    const chunkEndY = Math.min(range.endY, chunkStartY + EXTRACTION_CHUNK_LINES - 1);
    const scrollbackChunk = await fetchScrollbackChunk({
      scrollbackLength: options.scrollbackLength,
      chunkStartY,
      chunkEndY,
      fetchScrollbackLines: options.fetchScrollbackLines,
    });
    if (scrollbackChunk instanceof TextExtractionError) {
      return scrollbackChunk;
    }

    for (let absY = chunkStartY; absY <= chunkEndY; absY += 1) {
      const bounds = getRangeRowBounds(range, absY);
      if (!bounds) continue;

      const row =
        absY < options.scrollbackLength
          ? (scrollbackChunk.get(absY) ?? null)
          : options.getLiveLine(absY);
      if (!row) continue;

      lines.push(renderRowText(row, bounds.startX, bounds.endX));
    }
  }

  return lines.join('\n');
}

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
export const prepareCopyText = (text: string): CopyResult | null => {
  if (text.length === 0) return null;
  return { text, length: text.length };
};
