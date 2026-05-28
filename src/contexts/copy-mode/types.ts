import type { SelectionBounds, TerminalState } from '../../core/types';
import type { SelectionRange } from '../../core/coordinates';

export type CopyVisualType = 'char' | 'line' | 'block';

export interface CopyCursor {
  x: number;
  absY: number;
}

export interface CopyModeState {
  ptyId: string;
  cursor: CopyCursor;
  anchor: CopyCursor | null;
  visualType: CopyVisualType | null;
  selectionRange: SelectionRange | null;
  bounds: SelectionBounds | null;
  /** Custom terminal state getter for aggregate view PTYs (optional) */
  getTerminalState?: (ptyId: string) => TerminalState | null;
}

export interface CopyModeContextValue {
  /** Enter copy mode for a PTY (optionally with custom terminal state getter for aggregate view) */
  enterCopyMode: (
    ptyId: string,
    getTerminalState?: (ptyId: string) => TerminalState | null
  ) => void;
  /** Exit copy mode */
  exitCopyMode: () => void;
  /** Whether copy mode is active (optionally for a PTY) */
  isActive: (ptyId?: string) => boolean;
  /** Get active PTY ID */
  getActivePtyId: () => string | null;
  /** Get virtual cursor for a PTY */
  getCursor: (ptyId: string) => CopyCursor | null;
  /** Move cursor by delta */
  moveCursorBy: (dx: number, dy: number) => void;
  /** Move cursor to absolute position */
  moveCursorTo: (cursor: CopyCursor) => void;
  /** Move cursor to top/bottom */
  moveToTop: () => void;
  moveToBottom: () => void;
  /** Move cursor to line start/end */
  moveToLineStart: () => void;
  moveToLineEnd: () => void;
  moveToLineFirstNonBlank: () => void;
  /** Get current viewport row count */
  getViewportRows: () => number;
  /** Word motions */
  moveWordForward: () => void;
  moveWordBackward: () => void;
  moveWordEnd: () => void;
  /** WORD motions (whitespace-delimited) */
  moveWideWordForward: () => void;
  moveWideWordBackward: () => void;
  moveWideWordEnd: () => void;
  /** Toggle visual selection */
  toggleVisual: (type: CopyVisualType) => void;
  /** Start visual selection without toggling off */
  startSelection: (type: CopyVisualType) => void;
  /** Select word under cursor (inner/around) */
  selectWord: (mode: 'inner' | 'around') => void;
  /** Select current line */
  selectLine: () => void;
  /** Copy current selection or line */
  copySelection: () => Promise<void>;
  /** Clear visual selection */
  clearSelection: () => void;
  /** Whether a cell is selected in copy mode */
  isCellSelected: (ptyId: string, x: number, absY: number) => boolean;
  /** Whether selection exists for a PTY */
  hasSelection: (ptyId: string) => boolean;
  /** Version counter for re-render triggers */
  copyModeVersion: number;
}
