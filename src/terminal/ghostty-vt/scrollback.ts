import type { TerminalCell } from '../../core/types';
import type { TerminalColors } from '../terminal-colors';
import { convertLine } from '../ghostty-emulator/cell-converter';
import type { ScrollbackCache } from '../emulator-utils';
import type { GhosttyVtTerminal } from './terminal';

export function fetchScrollbackLine(params: {
  terminal: GhosttyVtTerminal;
  offset: number;
  cols: number;
  colors: TerminalColors;
  cache: ScrollbackCache;
  snapshotDirty: boolean;
  setSnapshotDirty: (value: boolean) => void;
}): TerminalCell[] | null {
  const { terminal, offset, cols, colors, cache, snapshotDirty, setSnapshotDirty } = params;
  const cached = cache.get(offset);
  if (cached) return cached;

  if (snapshotDirty) {
    terminal.update();
    setSnapshotDirty(false);
  }
  const line = terminal.getScrollbackLine(offset);
  if (!line) return null;

  const converted = convertLine(line, 0, line.length, cols, colors);
  cache.set(offset, converted);
  return converted;
}
