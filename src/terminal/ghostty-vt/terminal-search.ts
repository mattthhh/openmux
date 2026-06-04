/**
 * Search helpers for Ghostty VT terminal emulation.
 */

import type { TerminalCell, TerminalState } from '../../core/types';
import type { SearchMatch, SearchResult } from '../emulator-interface';
import { extractLineText } from './utils';

export function searchTerminal(
  query: string,
  options: { limit?: number } | undefined,
  source: {
    getScrollbackLength: () => number;
    getScrollbackLine: (offset: number) => TerminalCell[] | null;
    getTerminalState: () => TerminalState;
    createEmptyRow: (cols: number) => TerminalCell[];
  }
): SearchResult {
  const limit = options?.limit ?? 500;
  const matches: SearchMatch[] = [];
  let hasMore = false;

  if (!query) {
    return { matches, hasMore };
  }

  const lowerQuery = query.toLowerCase();
  const scrollbackLength = source.getScrollbackLength();

  for (let offset = 0; offset < scrollbackLength; offset++) {
    if (matches.length >= limit) {
      hasMore = true;
      break;
    }

    const cells = source.getScrollbackLine(offset);
    if (!cells) continue;

    const text = extractLineText(cells).toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
      if (matches.length >= limit) {
        hasMore = true;
        break;
      }
      matches.push({
        lineIndex: offset,
        startCol: pos,
        endCol: pos + query.length,
      });
      pos += 1;
    }
  }

  if (!hasMore) {
    const state = source.getTerminalState();
    for (let y = 0; y < state.rows; y++) {
      const line = state.cells[y] ?? source.createEmptyRow(state.cols);
      const text = extractLineText(line).toLowerCase();
      let pos = 0;
      while ((pos = text.indexOf(lowerQuery, pos)) !== -1) {
        matches.push({
          lineIndex: scrollbackLength + y,
          startCol: pos,
          endCol: pos + query.length,
        });
        pos += 1;
      }
    }
  }

  return { matches, hasMore };
}
