/**
 * Integration-ish tests for scroll state stability during alt-screen toggles.
 */

import { describe, it, expect, vi } from 'bun:test';
import { getCurrentScrollState } from '../../../../src/effect/services/pty/notification';
import { extractSelectedText } from '../../../../src/core/coordinates/selection-coords';
import type { ITerminalEmulator } from '../../../../src/terminal/emulator-interface';
import type { InternalPtySession } from '../../../../src/effect/services/pty/types';
import type { TerminalCell } from '../../../../src/core/types';

function createCell(char: string): TerminalCell {
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

function rowFromText(text: string): TerminalCell[] {
  return Array.from(text, (char) => createCell(char));
}

function createEmulator(getScrollbackLength: () => number): ITerminalEmulator {
  return {
    cols: 80,
    rows: 24,
    isDisposed: false,
    write() {},
    resize() {},
    reset() {},
    dispose() {},
    getScrollbackLength,
    getScrollbackLine() {
      return null;
    },
    getDirtyUpdate() {
      return {
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: false },
        scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
        cols: 80,
        rows: 24,
        isFull: false,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
        inBandResize: false,
      };
    },
    getTerminalState() {
      return {
        cols: 80,
        rows: 24,
        cells: [],
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
      return {
        foreground: 0xffffff,
        background: 0x000000,
        palette: [],
        isDefault: true,
      };
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
}

describe('getCurrentScrollState alt-screen transitions', () => {
  it('clamps viewportOffset when scrollback drops to 0, then stays stable after restore', () => {
    let scrollbackLength = 4;
    const emulator = createEmulator(() => scrollbackLength);
    const liveEmulator = createEmulator(() => 0);
    const clearCache = vi.fn();

    const session = {
      emulator,
      liveEmulator,
      scrollbackArchive: { clearCache },
      scrollState: {
        viewportOffset: 2,
        lastScrollbackLength: 4,
        lastIsAtBottom: false,
      },
    } as unknown as InternalPtySession;

    const scrollbackRows = [
      rowFromText('S0__'),
      rowFromText('S1__'),
      rowFromText('S2__'),
      rowFromText('S3__'),
      rowFromText('S4__'),
      rowFromText('S5__'),
    ];
    const liveRows = [
      rowFromText('L0__'),
      rowFromText('L1__'),
      rowFromText('L2__'),
      rowFromText('L3__'),
      rowFromText('L4__'),
      rowFromText('L5__'),
    ];

    const getLine = (absoluteY: number) => {
      if (absoluteY < scrollbackLength) {
        return scrollbackRows[absoluteY] ?? null;
      }
      return liveRows[absoluteY - scrollbackLength] ?? null;
    };

    const selection = {
      startX: 0,
      startY: 2,
      endX: 4,
      endY: 5,
      focusAtEnd: true,
    };

    const before = getCurrentScrollState(session);
    expect(before.viewportOffset).toBe(2);
    expect(before.isAtBottom).toBe(false);
    expect(extractSelectedText(selection, scrollbackLength, getLine)).toBe(
      'S2__\nS3__\nL0__\nL1__'
    );

    // Simulate alt-screen entry: scrollback clears.
    scrollbackLength = 0;
    const duringAlt = getCurrentScrollState(session);
    expect(duringAlt.scrollbackLength).toBe(0);
    expect(duringAlt.viewportOffset).toBe(0);
    expect(duringAlt.isAtBottom).toBe(true);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(extractSelectedText(selection, scrollbackLength, getLine)).toBe(
      'L2__\nL3__\nL4__\nL5__'
    );

    // Simulate alt-screen exit: scrollback restored.
    scrollbackLength = 6;
    const after = getCurrentScrollState(session);
    expect(after.scrollbackLength).toBe(6);
    expect(after.viewportOffset).toBe(0);
    expect(after.isAtBottom).toBe(true);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(extractSelectedText(selection, scrollbackLength, getLine)).toBe(
      'S2__\nS3__\nS4__\nS5__'
    );
  });
});
