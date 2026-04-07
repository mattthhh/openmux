/**
 * Search helper functions - pure utilities for terminal search
 */
import type { TerminalCell, TerminalState } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { SearchMatch } from './types';

/**
 * Height of search overlay (3 rows + 1 margin from bottom + 1 for status bar)
 * This is used to avoid centering matches behind the search bar
 */
export const SEARCH_OVERLAY_HEIGHT = 5;

/**
 * Extract text from a row of terminal cells
 * Uses array join instead of string concatenation to avoid O(n) intermediate strings
 */
export function extractLineText(cells: TerminalCell[]): string {
  const chars: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    chars.push(cells[i].char);
    // Skip placeholder for wide characters
    if (cells[i].width === 2) {
      i++;
    }
  }
  return chars.join('');
}

/**
 * Check if a cell at (x, absoluteY) is within a match
 */
export function isCellInMatch(x: number, absoluteY: number, match: SearchMatch): boolean {
  return absoluteY === match.lineIndex && x >= match.startCol && x < match.endCol;
}

/**
 * Calculate viewport offset to show a specific line centered in viewport
 * Accounts for the search overlay at the bottom by centering in the visible area above it
 *
 * Coordinate system:
 * - lineIndex: absolute line index (0 = oldest scrollback, scrollbackLength = first visible terminal line)
 * - viewportOffset: how many lines scrolled back (0 = at bottom showing live terminal)
 * - Screen row y shows absoluteY = scrollbackLength - viewportOffset + y
 */
export function calculateScrollOffset(
  lineIndex: number,
  scrollbackLength: number,
  terminalRows: number
): number {
  // Calculate effective viewport (excluding search overlay area)
  const effectiveRows = terminalRows - SEARCH_OVERLAY_HEIGHT;
  const centerPoint = Math.floor(effectiveRows / 2);

  // To show lineIndex at screen row centerPoint:
  // lineIndex = scrollbackLength - viewportOffset + centerPoint
  // viewportOffset = scrollbackLength - lineIndex + centerPoint
  const targetOffset = scrollbackLength - lineIndex + centerPoint;

  // Clamp to valid range [0, scrollbackLength]
  return Math.max(0, Math.min(targetOffset, scrollbackLength));
}

/**
 * Build spatial index for O(1) match lookup by line
 * Returns Map<lineIndex, Array<{startCol, endCol}>>
 */
export function buildMatchLookup(
  matches: SearchMatch[]
): Map<number, Array<{ startCol: number; endCol: number }>> {
  const lookup = new Map<number, Array<{ startCol: number; endCol: number }>>();

  for (const match of matches) {
    const existing = lookup.get(match.lineIndex) ?? [];
    existing.push({ startCol: match.startCol, endCol: match.endCol });
    lookup.set(match.lineIndex, existing);
  }

  return lookup;
}
