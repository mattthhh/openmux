import { describe, expect, test } from 'bun:test';
import type { TerminalCell, TerminalState } from '../../src/core/types';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';
import { captureEmulator } from '../../src/control/capture';

function makeCell(char: string, overrides: Partial<TerminalCell> = {}): TerminalCell {
  return {
    char,
    fg: overrides.fg ?? { r: 255, g: 255, b: 255 },
    bg: overrides.bg ?? { r: 0, g: 0, b: 0 },
    bold: overrides.bold ?? false,
    italic: overrides.italic ?? false,
    underline: overrides.underline ?? false,
    strikethrough: overrides.strikethrough ?? false,
    inverse: overrides.inverse ?? false,
    blink: overrides.blink ?? false,
    dim: overrides.dim ?? false,
    width: overrides.width ?? 1,
    hyperlinkId: overrides.hyperlinkId,
  };
}

function makeLine(text: string, overrides: Partial<TerminalCell> = {}): TerminalCell[] {
  return text.split('').map((char) => makeCell(char, overrides));
}

function createEmulator(params: {
  scrollback: TerminalCell[][];
  live: TerminalCell[][];
}): ITerminalEmulator {
  const state: TerminalState = {
    cols: params.live[0]?.length ?? 0,
    rows: params.live.length,
    cells: params.live,
    cursor: { x: 0, y: 0, visible: true },
    alternateScreen: false,
    mouseTracking: false,
  };

  return {
    cols: state.cols,
    rows: state.rows,
    isDisposed: false,
    write: () => {},
    resize: () => {},
    reset: () => {},
    dispose: () => {},
    getScrollbackLength: () => params.scrollback.length,
    getScrollbackLine: (offset: number) => params.scrollback[offset] ?? null,
    getDirtyUpdate: () => {
      throw new Error('not used');
    },
    getTerminalState: () => state,
    getCursor: () => ({ x: 0, y: 0, visible: true }),
    getCursorKeyMode: () => 'normal',
    getKittyKeyboardFlags: () => 0,
    isMouseTrackingEnabled: () => false,
    isAlternateScreen: () => false,
    getMode: () => false,
    getColors: () => ({ foreground: 0, background: 0, palette: [] as number[] }),
    getTitle: () => '',
    onTitleChange: () => () => {},
    onUpdate: () => () => {},
    onModeChange: () => () => {},
    search: async () => ({ matches: [], hasMore: false }),
  } satisfies ITerminalEmulator;
}

describe('captureEmulator', () => {
  test('captures the last N lines of scrollback and live buffer', () => {
    const emulator = createEmulator({
      scrollback: [makeLine('old1'), makeLine('old2')],
      live: [makeLine('new1'), makeLine('new2')],
    });

    const output = captureEmulator(emulator, { lines: 3, format: 'text' });
    expect(output).toBe('old2\nnew1\nnew2');
  });

  test('renders ansi output with colors and reset', () => {
    const red = { r: 255, g: 0, b: 0 };
    const emulator = createEmulator({
      scrollback: [],
      live: [[makeCell('R', { fg: red })]],
    });

    const output = captureEmulator(emulator, { lines: 1, format: 'ansi' });
    expect(output).toContain('38;2;255;0;0');
    expect(output).toContain('R');
    expect(output).toContain('\u001b[0m');
  });

  test('trims trailing empty lines before slicing', () => {
    const emulator = createEmulator({
      scrollback: [],
      live: [makeLine('one'), makeLine('   '), makeLine('   ')],
    });

    const output = captureEmulator(emulator, { lines: 2, format: 'text' });
    expect(output).toBe('one');
  });

  test('raw capture keeps trailing blanks', () => {
    const emulator = createEmulator({
      scrollback: [],
      live: [makeLine('one'), makeLine('   '), makeLine('   ')],
    });

    const output = captureEmulator(emulator, {
      lines: 2,
      format: 'text',
      trimTrailing: false,
      trimTrailingLines: false,
    });
    expect(output).toBe('   \n   ');
  });
});
