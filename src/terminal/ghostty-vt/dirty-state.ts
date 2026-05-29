import type { TerminalCell, TerminalState } from '../../core/types';
import type { TerminalModes } from '../emulator-interface';
import type { TerminalColors } from '../terminal-colors';
import { convertLine } from '../ghostty-emulator/cell-converter';
import type { GhosttyVtTerminal } from './terminal';

type Cursor = { x: number; y: number; visible: boolean };

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
    for (let y = 0; y < rows; y++) {
      if (!terminal.isRowDirty(y)) continue;
      const offset = y * cols;
      dirtyRows.set(y, convertLine(viewport, offset, cols, cols, colors));
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
