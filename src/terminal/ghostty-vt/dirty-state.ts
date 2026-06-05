import type { TerminalCell, TerminalState } from '../../core/types';
import type { TerminalModes } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { convertLine } from '../ghostty-emulator/cell-converter';
import type { GhosttyVtTerminal } from './terminal';

type Cursor = { x: number; y: number; visible: boolean };

/** Quick equality check for two TerminalCell rows. Returns true if identical. */
function rowCellsEqual(a: TerminalCell[] | undefined, b: TerminalCell[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ac = a[i];
    const bc = b[i];
    if (
      ac.char !== bc.char ||
      ac.fg.r !== bc.fg.r ||
      ac.fg.g !== bc.fg.g ||
      ac.fg.b !== bc.fg.b ||
      ac.bg.r !== bc.bg.r ||
      ac.bg.g !== bc.bg.g ||
      ac.bg.b !== bc.bg.b ||
      ac.defaultBg !== bc.defaultBg ||
      ac.bold !== bc.bold ||
      ac.italic !== bc.italic ||
      ac.underline !== bc.underline ||
      ac.strikethrough !== bc.strikethrough ||
      ac.inverse !== bc.inverse ||
      ac.width !== bc.width
    ) {
      return false;
    }
  }
  return true;
}

export function buildDirtyState({
  terminal,
  viewport,
  cols,
  rows,
  colors,
  cachedState,
  shouldBuildFull,
  cursor,
  modes,
  kittyKeyboardFlags,
}: {
  terminal: GhosttyVtTerminal;
  viewport: ReturnType<GhosttyVtTerminal['getViewport']> | null;
  cols: number;
  rows: number;
  colors: TerminalColors;
  cachedState: TerminalState | null;
  shouldBuildFull: boolean;
  cursor: Cursor;
  modes: TerminalModes;
  kittyKeyboardFlags: number;
}): {
  cachedState: TerminalState | null;
  dirtyRows: Map<number, TerminalCell[]>;
  fullState?: TerminalState;
} {
  let dirtyRows = new Map<number, TerminalCell[]>();
  let fullState: TerminalState | undefined;

  if (shouldBuildFull) {
    const cells: TerminalCell[][] = [];
    if (viewport) {
      for (let y = 0; y < rows; y++) {
        const offset = y * cols;
        cells.push(convertLine(viewport, offset, cols, cols, colors));
      }
    }

    fullState = {
      cols,
      rows,
      cells,
      cursor: {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: 'block',
      },
      alternateScreen: modes.alternateScreen,
      mouseTracking: modes.mouseTracking,
      cursorKeyMode: modes.cursorKeyMode,
      kittyKeyboardFlags,
    };
    cachedState = fullState;
  } else if (viewport) {
    // Always convert all rows from the viewport, not just rows where
    // isRowDirty returns true. The native RenderState's dirty tracking
    // can miss rows (e.g., after scrollback reflow, resize, or internal
    // state machine transitions), causing permanent stale content in
    // cachedState that only a forceFull (resize) would fix. Converting
    // all rows guarantees cachedState stays in sync with the terminal.
    // The overhead is minimal: one convertLine per row (~0.02ms per row)
    // versus the isRowDirty FFI call it replaces (~0.001ms per row),
    // so the total cost is ~0.5ms for a 24-row terminal at 30fps.
    for (let y = 0; y < rows; y++) {
      const offset = y * cols;
      const converted = convertLine(viewport, offset, cols, cols, colors);
      // Skip rows that haven't changed since the last update. This
      // avoids unnecessary subscriber work (SolidJS re-renders) for
      // unchanged rows while still catching rows that isRowDirty missed.
      if (cachedState && rowCellsEqual(cachedState.cells[y], converted)) {
        continue;
      }
      dirtyRows.set(y, converted);
    }

    if (cachedState) {
      for (const [rowIdx, cells] of dirtyRows) {
        cachedState.cells[rowIdx] = cells;
      }
      cachedState.cursor = {
        x: cursor.x,
        y: cursor.y,
        visible: cursor.visible,
        style: 'block',
      };
      cachedState.alternateScreen = modes.alternateScreen;
      cachedState.mouseTracking = modes.mouseTracking;
      cachedState.cursorKeyMode = modes.cursorKeyMode;
      cachedState.kittyKeyboardFlags = kittyKeyboardFlags;
    }
  } else if (cachedState) {
    cachedState.cursor = {
      x: cursor.x,
      y: cursor.y,
      visible: cursor.visible,
      style: 'block',
    };
    cachedState.alternateScreen = modes.alternateScreen;
    cachedState.mouseTracking = modes.mouseTracking;
    cachedState.cursorKeyMode = modes.cursorKeyMode;
    cachedState.kittyKeyboardFlags = kittyKeyboardFlags;
  }

  return { cachedState, dirtyRows, fullState };
}
