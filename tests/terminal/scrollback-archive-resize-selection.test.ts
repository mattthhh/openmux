/**
 * Tests for archived scrollback behavior across resize + selection.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'bun:test';
import { ArchivedTerminalEmulator } from '../../src/terminal/archived-emulator';
import { ScrollbackArchive } from '../../src/terminal/scrollback-archive';
import { extractSelectedText } from '../../src/core/coordinates/selection-coords';
import { getDefaultColors } from '../../src/terminal/terminal-colors';
import type {
  DirtyTerminalUpdate,
  TerminalCell,
  TerminalScrollState,
  TerminalState,
} from '../../src/core/types';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';

type EmulatorHarness = {
  emulator: ArchivedTerminalEmulator;
  setLiveCells: (cells: TerminalCell[][]) => void;
  dispose: () => void;
};

function createTestCell(char: string): TerminalCell {
  return {
    char,
    fg: { r: 255, g: 255, b: 255 },
    bg: { r: 0, g: 0, b: 0 },
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
    dim: false,
    width: 1,
  };
}

function rowFromString(value: string): TerminalCell[] {
  return Array.from(value, (char) => createTestCell(char));
}

async function createHarness(options: {
  archivedLines: string[];
  liveLines: string[];
  cols: number;
  rows: number;
}): Promise<EmulatorHarness> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-archive-test-'));
  const archive = new ScrollbackArchive({
    rootDir: tmpDir,
    maxBytes: 1024 * 1024,
    chunkMaxLines: 10,
    cacheSize: 100,
  });

  await archive.appendLines(options.archivedLines.map(rowFromString));

  let liveCells = options.liveLines.map(rowFromString);
  let cols = options.cols;
  let rows = options.rows;

  const baseEmulator: ITerminalEmulator = {
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    isDisposed: false,
    write() {},
    resize(nextCols, nextRows) {
      cols = nextCols;
      rows = nextRows;
    },
    reset() {},
    dispose() {},
    getScrollbackLength() {
      return 0;
    },
    getScrollbackLine() {
      return null;
    },
    getDirtyUpdate(scrollState: TerminalScrollState): DirtyTerminalUpdate {
      return {
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: false },
        scrollState,
        cols,
        rows,
        isFull: false,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
        inBandResize: false,
      };
    },
    getTerminalState(): TerminalState {
      return {
        cols,
        rows,
        cells: liveCells,
        cursor: { x: 0, y: 0, visible: false },
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
      };
    },
    getCursor() {
      return { x: 0, y: 0, visible: false };
    },
    getCursorKeyMode() {
      return 'normal';
    },
    getKittyKeyboardFlags() {
      return 0;
    },
    isMouseTrackingEnabled() {
      return false;
    },
    isAlternateScreen() {
      return false;
    },
    getMode() {
      return false;
    },
    getColors() {
      return getDefaultColors();
    },
    getTitle() {
      return '';
    },
    onTitleChange() {
      return () => {};
    },
    onUpdate() {
      return () => {};
    },
    onModeChange() {
      return () => {};
    },
    async search() {
      return { matches: [], hasMore: false };
    },
  };

  const emulator = new ArchivedTerminalEmulator(baseEmulator, archive);

  return {
    emulator,
    setLiveCells(nextCells) {
      liveCells = nextCells;
    },
    dispose() {
      emulator.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('scrollback archive resize + selection', () => {
  it('keeps archived row width stable across resize', async () => {
    const harness = await createHarness({
      archivedLines: ['ABCD'],
      liveLines: ['LIVE'],
      cols: 4,
      rows: 1,
    });

    try {
      const line = harness.emulator.getScrollbackLine(0);
      expect(line?.length).toBe(4);

      harness.emulator.resize(2, 1);
      const resizedLine = harness.emulator.getScrollbackLine(0);
      expect(resizedLine?.length).toBe(4);
    } finally {
      harness.dispose();
    }
  });

  it('extracts selection across archived + live rows after resize', async () => {
    const harness = await createHarness({
      archivedLines: ['ABCD', 'EFGH'],
      liveLines: ['IJKL'],
      cols: 4,
      rows: 1,
    });

    try {
      const scrollbackLength = harness.emulator.getScrollbackLength();
      const getLine = (absoluteY: number) => {
        if (absoluteY < scrollbackLength) {
          return harness.emulator.getScrollbackLine(absoluteY);
        }
        const liveY = absoluteY - scrollbackLength;
        return harness.emulator.getTerminalState().cells[liveY] ?? null;
      };

      const range = {
        startX: 0,
        startY: 0,
        endX: 4,
        endY: 2,
        focusAtEnd: true,
      };

      const before = extractSelectedText(range, scrollbackLength, getLine);
      expect(before).toBe('ABCD\nEFGH\nIJKL');

      harness.emulator.resize(2, 1);
      const after = extractSelectedText(range, scrollbackLength, getLine);
      expect(after).toBe('ABCD\nEFGH\nIJKL');
    } finally {
      harness.dispose();
    }
  });
});
