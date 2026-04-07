/**
 * Navigation types for copy mode
 */

import type { TerminalState, TerminalCell } from '../../../core/types';

/** Scroll and viewport metadata for navigation */
export interface ScrollMeta {
  terminalState: TerminalState | null;
  emulator: {
    getScrollbackLength: () => number;
    getScrollbackLine: (y: number) => TerminalCell[] | null;
  } | null;
  scrollbackLength: number;
  rows: number;
  cols: number;
  viewportOffset: number;
}

/** Function to get scroll metadata for a PTY */
export type GetScrollMeta = (
  ptyId: string,
  overrideGetTerminalState?: (ptyId: string) => TerminalState | null
) => ScrollMeta;
