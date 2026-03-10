/**
 * Navigation types for copy mode
 */

import type { TerminalState } from '../../../core/types';

/** Scroll and viewport metadata for navigation */
export interface ScrollMeta {
  terminalState: TerminalState | null;
  emulator: {
    getScrollbackLength: () => number;
    getScrollbackLine: (y: number) => import('../../../core/types').TerminalCell[] | null;
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
