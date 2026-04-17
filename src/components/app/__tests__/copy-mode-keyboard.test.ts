/**
 * Copy mode keyboard handler tests
 * Covers paste (Cmd+V), escape, motions, and operator-pending behavior
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createCopyModeKeyHandler } from '../copy-mode-keyboard';
import type { CopyModeContextValue } from '../../../contexts/copy-mode';
import type { KeyboardEvent } from '../../../core/keyboard-event';

type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

const createMockVimHandler = (): VimSequenceHandler => ({
  handleCombo: () => ({ action: null, pending: false }),
  reset: mock(() => {}),
});

const createMockCopyMode = (
  overrides: Partial<CopyModeContextValue> = {}
): CopyModeContextValue => ({
  enterCopyMode: mock(() => {}),
  exitCopyMode: mock(() => {}),
  isActive: mock(() => true),
  getActivePtyId: mock(() => 'test-pty'),
  getCursor: mock(() => ({ x: 5, absY: 50 })),
  moveCursorBy: mock(() => {}),
  moveCursorTo: mock(() => {}),
  moveToTop: mock(() => {}),
  moveToBottom: mock(() => {}),
  moveToLineStart: mock(() => {}),
  moveToLineEnd: mock(() => {}),
  moveToLineFirstNonBlank: mock(() => {}),
  getViewportRows: mock(() => 24),
  moveWordForward: mock(() => {}),
  moveWordBackward: mock(() => {}),
  moveWordEnd: mock(() => {}),
  moveWideWordForward: mock(() => {}),
  moveWideWordBackward: mock(() => {}),
  moveWideWordEnd: mock(() => {}),
  toggleVisual: mock(() => {}),
  startSelection: mock(() => {}),
  selectWord: mock(() => {}),
  selectLine: mock(() => {}),
  copySelection: mock(() => Promise.resolve()),
  clearSelection: mock(() => {}),
  isCellSelected: mock(() => false),
  hasSelection: mock(() => false),
  copyModeVersion: 0,
  ...overrides,
});

const press = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent => {
  const key = overrides.key ?? 'a';
  // Default sequence to the key value for single-char keys (digits, letters, symbols)
  // This matches how OpenTUI delivers keyboard events
  const defaultSequence = key.length === 1 ? key : overrides.sequence;
  return {
    key,
    ctrl: overrides.ctrl ?? false,
    alt: overrides.alt ?? false,
    shift: overrides.shift ?? false,
    meta: overrides.meta ?? false,
    sequence: overrides.sequence ?? defaultSequence,
    eventType: 'press',
    repeated: false,
  };
};

describe('createCopyModeKeyHandler', () => {
  let copyMode: CopyModeContextValue;
  let exitCopyMode: ReturnType<typeof mock<() => void>>;
  let pasteCallback: ReturnType<typeof mock<() => void>>;
  let vimHandler: VimSequenceHandler;
  let handler: (event: KeyboardEvent) => boolean;

  beforeEach(() => {
    copyMode = createMockCopyMode();
    exitCopyMode = mock(() => {});
    pasteCallback = mock(() => {});
    vimHandler = createMockVimHandler();
    handler = createCopyModeKeyHandler({
      copyMode,
      exitCopyMode,
      pasteCallback,
      getVimHandler: () => vimHandler,
    });
  });

  describe('paste: Cmd+V / meta+v', () => {
    it('exits copy mode and calls pasteCallback on meta+v', () => {
      const result = handler(press({ key: 'v', meta: true }));
      expect(result).toBe(true);
      expect(exitCopyMode).toHaveBeenCalledTimes(1);
      expect(pasteCallback).toHaveBeenCalledTimes(1);
    });

    it('does not paste on plain v (that toggles visual)', () => {
      handler(press({ key: 'v' }));
      expect(pasteCallback).not.toHaveBeenCalled();
    });

    it('does not paste on ctrl+v (that toggles block visual)', () => {
      handler(press({ key: 'v', ctrl: true }));
      expect(pasteCallback).not.toHaveBeenCalled();
    });

    it('works without pasteCallback (aggregate view copy mode)', () => {
      const handlerNoPaste = createCopyModeKeyHandler({
        copyMode,
        exitCopyMode,
        getVimHandler: () => vimHandler,
      });
      const result = handlerNoPaste(press({ key: 'v', meta: true }));
      expect(result).toBe(true);
      expect(exitCopyMode).toHaveBeenCalledTimes(1);
    });
  });

  describe('escape key', () => {
    it('exits copy mode on bare escape with no selection', () => {
      handler(press({ key: 'escape' }));
      expect(exitCopyMode).toHaveBeenCalledTimes(1);
    });

    it('clears selection on escape when selection is active', () => {
      copyMode.hasSelection = mock(() => true);
      handler(press({ key: 'escape' }));
      expect(copyMode.clearSelection).toHaveBeenCalledTimes(1);
      expect(exitCopyMode).not.toHaveBeenCalled();
    });

    it('does not exit on escape with ctrl modifier', () => {
      handler(press({ key: 'escape', ctrl: true }));
      expect(exitCopyMode).not.toHaveBeenCalled();
    });
  });

  describe('exit: q key', () => {
    it('exits copy mode on q', () => {
      handler(press({ key: 'q' }));
      expect(exitCopyMode).toHaveBeenCalledTimes(1);
    });

    it('does not exit on ctrl+q', () => {
      handler(press({ key: 'q', ctrl: true }));
      expect(exitCopyMode).not.toHaveBeenCalled();
    });
  });

  describe('copy: enter and y', () => {
    it('copies and clears on enter', () => {
      handler(press({ key: 'enter' }));
      expect(copyMode.copySelection).toHaveBeenCalledTimes(1);
      expect(copyMode.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('copies and clears on y with visual selection', () => {
      copyMode.hasSelection = mock(() => true);
      handler(press({ key: 'y' }));
      expect(copyMode.copySelection).toHaveBeenCalledTimes(1);
      expect(copyMode.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('starts operator on y without visual selection', () => {
      copyMode.hasSelection = mock(() => false);
      handler(press({ key: 'y' }));
      // y without visual starts operator-pending mode (yank operator)
      // Next key should be treated as a motion
      expect(copyMode.copySelection).not.toHaveBeenCalled();
    });
  });

  describe('cursor motions', () => {
    it('moves cursor left on h', () => {
      handler(press({ key: 'h' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(-1, 0);
    });

    it('moves cursor down on j', () => {
      handler(press({ key: 'j' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, 1);
    });

    it('moves cursor up on k', () => {
      handler(press({ key: 'k' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, -1);
    });

    it('moves cursor right on l', () => {
      handler(press({ key: 'l' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(1, 0);
    });

    it('respects count prefix for motions', () => {
      handler(press({ key: '3', sequence: '3' }));
      handler(press({ key: 'j', sequence: 'j' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, 3);
    });

    it('moves to line start on 0 (bare, not as count prefix)', () => {
      // 0 without a preceding count digit moves to line start
      handler(press({ key: '0', sequence: '0' }));
      expect(copyMode.moveToLineStart).toHaveBeenCalledTimes(1);
    });

    it('moves to line end on $', () => {
      handler(press({ key: '$', sequence: '$', shift: true }));
      expect(copyMode.moveToLineEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('visual mode', () => {
    it('toggles char visual on v', () => {
      handler(press({ key: 'v' }));
      expect(copyMode.toggleVisual).toHaveBeenCalledWith('char');
    });

    it('toggles line visual on V', () => {
      handler(press({ key: 'V', shift: true, sequence: 'V' }));
      expect(copyMode.toggleVisual).toHaveBeenCalledWith('line');
    });

    it('toggles block visual on ctrl+v', () => {
      handler(press({ key: 'v', ctrl: true }));
      expect(copyMode.toggleVisual).toHaveBeenCalledWith('block');
    });
  });

  describe('release events', () => {
    it('returns true for release events without processing', () => {
      const result = handler(press({ key: 'a', eventType: 'release' }));
      expect(result).toBe(true);
      expect(copyMode.moveCursorBy).not.toHaveBeenCalled();
    });
  });

  describe('scroll motions', () => {
    it('scrolls up by viewport on pageup', () => {
      handler(press({ key: 'pageup' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, -23);
    });

    it('scrolls down by viewport on pagedown', () => {
      handler(press({ key: 'pagedown' }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, 23);
    });

    it('scrolls up by half viewport on ctrl+u', () => {
      handler(press({ key: 'u', ctrl: true }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, -12);
    });

    it('scrolls down by half viewport on ctrl+d', () => {
      handler(press({ key: 'd', ctrl: true }));
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, 12);
    });
  });

  describe('operator-pending mode', () => {
    it('yanks current line on yy', () => {
      handler(press({ key: 'y' }));
      handler(press({ key: 'y' }));
      expect(copyMode.startSelection).toHaveBeenCalledWith('line');
      expect(copyMode.copySelection).toHaveBeenCalledTimes(1);
    });

    it('yanks with motion on yj', () => {
      handler(press({ key: 'y' }));
      handler(press({ key: 'j' }));
      expect(copyMode.startSelection).toHaveBeenCalledWith('char');
      expect(copyMode.copySelection).toHaveBeenCalledTimes(1);
    });

    it('yanks with count on y2j', () => {
      handler(press({ key: 'y' }));
      handler(press({ key: '2', sequence: '2' }));
      handler(press({ key: 'j', sequence: 'j' }));
      expect(copyMode.startSelection).toHaveBeenCalledWith('char');
      expect(copyMode.moveCursorBy).toHaveBeenCalledWith(0, 2);
    });
  });

  describe('word motions', () => {
    it('moves word forward on w', () => {
      handler(press({ key: 'w' }));
      expect(copyMode.moveWordForward).toHaveBeenCalledTimes(1);
    });

    it('moves word backward on b', () => {
      handler(press({ key: 'b' }));
      expect(copyMode.moveWordBackward).toHaveBeenCalledTimes(1);
    });

    it('moves word end on e', () => {
      handler(press({ key: 'e' }));
      expect(copyMode.moveWordEnd).toHaveBeenCalledTimes(1);
    });

    it('respects count for word motions', () => {
      handler(press({ key: '3', sequence: '3' }));
      handler(press({ key: 'w', sequence: 'w' }));
      expect(copyMode.moveWordForward).toHaveBeenCalledTimes(3);
    });
  });
});
