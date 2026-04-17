/**
 * Copy Mode Keyboard Handler
 * Handles keyboard input when in copy mode
 */

import { eventToCombo } from '../../core/keybindings';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { CopyModeContextValue } from '../../contexts/copy-mode';

type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export function createCopyModeKeyHandler(deps: {
  copyMode: CopyModeContextValue;
  exitCopyMode: () => void;
  pasteCallback?: () => void;
  getVimHandler: () => VimSequenceHandler;
}) {
  let countBuffer = '';
  let operatorPending = false;
  let operatorCount = 1;

  const resetCount = () => {
    countBuffer = '';
  };

  const hasCount = () => countBuffer.length > 0;

  const takeCount = () => {
    if (!countBuffer) return 1;
    const value = Number.parseInt(countBuffer, 10);
    resetCount();
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const resetOperator = () => {
    operatorPending = false;
    operatorCount = 1;
    resetCount();
  };

  const startOperator = () => {
    operatorPending = true;
    operatorCount = takeCount();
  };

  return (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      return true;
    }

    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    const combo = eventToCombo(keyEvent);
    const char = event.sequence && event.sequence.length === 1 ? event.sequence : null;
    const isBareEscape =
      event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

    const activePtyId = deps.copyMode.getActivePtyId();
    const hasVisual = activePtyId ? deps.copyMode.hasSelection(activePtyId) : false;

    if (isBareEscape) {
      if (hasVisual) {
        deps.copyMode.clearSelection();
        resetOperator();
        return true;
      }
      if (operatorPending || hasCount()) {
        resetOperator();
        return true;
      }
      resetOperator();
      deps.exitCopyMode();
      return true;
    }

    // Cmd+V / Super+V: exit copy mode and paste clipboard content to PTY
    if (combo === 'meta+v') {
      resetOperator();
      deps.exitCopyMode();
      deps.pasteCallback?.();
      return true;
    }

    if (combo === 'q' && !event.ctrl && !event.alt && !event.meta) {
      resetOperator();
      deps.exitCopyMode();
      return true;
    }

    if (combo === 'enter') {
      resetOperator();
      void deps.copyMode.copySelection();
      deps.copyMode.clearSelection();
      return true;
    }

    if (combo === 'y' && hasVisual) {
      resetOperator();
      void deps.copyMode.copySelection();
      deps.copyMode.clearSelection();
      return true;
    }

    if (char && /[0-9]/.test(char) && !event.ctrl && !event.alt && !event.meta && !event.shift) {
      if (char !== '0' || hasCount()) {
        countBuffer += char;
        return true;
      }
    }

    const getActiveCursor = () => {
      const activePtyId = deps.copyMode.getActivePtyId();
      if (!activePtyId) return null;
      return deps.copyMode.getCursor(activePtyId);
    };

    const applyOperatorMotion = (motion: () => void) => {
      deps.copyMode.startSelection('char');
      motion();
      void deps.copyMode.copySelection();
      deps.copyMode.clearSelection();
      resetOperator();
    };

    if (operatorPending) {
      const vimResult = deps.getVimHandler().handleCombo(combo);
      if (vimResult.pending) return true;
      if (vimResult.action) {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        switch (vimResult.action) {
          case 'cursor.top': {
            applyOperatorMotion(() => {
              if (totalCount > 1) {
                const cursor = getActiveCursor();
                if (cursor) {
                  deps.copyMode.moveCursorTo({ x: cursor.x, absY: totalCount - 1 });
                }
              } else {
                deps.copyMode.moveToTop();
              }
            });
            return true;
          }
          case 'select.inner.word':
            deps.copyMode.selectWord('inner');
            void deps.copyMode.copySelection();
            deps.copyMode.clearSelection();
            resetOperator();
            return true;
          case 'select.around.word':
            deps.copyMode.selectWord('around');
            void deps.copyMode.copySelection();
            deps.copyMode.clearSelection();
            resetOperator();
            return true;
          default:
            break;
        }
      }

      if (combo === 'y') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        deps.copyMode.startSelection('line');
        if (totalCount > 1) {
          deps.copyMode.moveCursorBy(0, totalCount - 1);
        }
        void deps.copyMode.copySelection();
        deps.copyMode.clearSelection();
        resetOperator();
        return true;
      }

      if (combo === 'h' || combo === 'left') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => deps.copyMode.moveCursorBy(-totalCount, 0));
        return true;
      }
      if (combo === 'j' || combo === 'down') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => deps.copyMode.moveCursorBy(0, totalCount));
        return true;
      }
      if (combo === 'k' || combo === 'up') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => deps.copyMode.moveCursorBy(0, -totalCount));
        return true;
      }
      if (combo === 'l' || combo === 'right') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => deps.copyMode.moveCursorBy(totalCount, 0));
        return true;
      }
      if (combo === 'w') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWordForward();
        });
        return true;
      }
      if (combo === 'b') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWordBackward();
        });
        return true;
      }
      if (combo === 'shift+w' || char === 'W') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWideWordForward();
        });
        return true;
      }
      if (combo === 'shift+b' || char === 'B') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWideWordBackward();
        });
        return true;
      }
      if (combo === 'e') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWordEnd();
        });
        return true;
      }
      if (combo === 'shift+e' || char === 'E') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          for (let i = 0; i < totalCount; i += 1) deps.copyMode.moveWideWordEnd();
        });
        return true;
      }
      if (char === '0') {
        applyOperatorMotion(() => deps.copyMode.moveToLineStart());
        return true;
      }
      if (char === '^') {
        applyOperatorMotion(() => deps.copyMode.moveToLineFirstNonBlank());
        return true;
      }
      if (char === '$') {
        applyOperatorMotion(() => deps.copyMode.moveToLineEnd());
        return true;
      }
      if (char === 'G' || combo === 'shift+g') {
        const motionCount = takeCount();
        const totalCount = operatorCount * motionCount;
        applyOperatorMotion(() => {
          if (totalCount > 1) {
            const cursor = getActiveCursor();
            if (cursor) {
              deps.copyMode.moveCursorTo({ x: cursor.x, absY: totalCount - 1 });
            }
          } else {
            deps.copyMode.moveToBottom();
          }
        });
        return true;
      }

      resetOperator();
    }

    if (combo === 'y') {
      startOperator();
      return true;
    }

    const vimResult = deps.getVimHandler().handleCombo(combo);
    if (vimResult.pending) return true;
    if (vimResult.action) {
      const count = takeCount();
      switch (vimResult.action) {
        case 'cursor.top': {
          if (count > 1) {
            const cursor = getActiveCursor();
            if (cursor) {
              deps.copyMode.moveCursorTo({ x: cursor.x, absY: count - 1 });
            }
          } else {
            deps.copyMode.moveToTop();
          }
          return true;
        }
        case 'select.inner.word':
          deps.copyMode.selectWord('inner');
          return true;
        case 'select.around.word':
          deps.copyMode.selectWord('around');
          return true;
        default:
          break;
      }
    }

    if (combo === 'ctrl+v') {
      resetOperator();
      deps.copyMode.toggleVisual('block');
      return true;
    }

    if (combo === 'v') {
      resetOperator();
      deps.copyMode.toggleVisual('char');
      return true;
    }

    if (combo === 'shift+v' || char === 'V') {
      resetOperator();
      deps.copyMode.toggleVisual('line');
      return true;
    }

    if (combo === 'h' || combo === 'left') {
      const count = takeCount();
      deps.copyMode.moveCursorBy(-count, 0);
      return true;
    }
    if (combo === 'j' || combo === 'down') {
      const count = takeCount();
      deps.copyMode.moveCursorBy(0, count);
      return true;
    }
    if (combo === 'k' || combo === 'up') {
      const count = takeCount();
      deps.copyMode.moveCursorBy(0, -count);
      return true;
    }
    if (combo === 'l' || combo === 'right') {
      const count = takeCount();
      deps.copyMode.moveCursorBy(count, 0);
      return true;
    }

    if (combo === 'w') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWordForward();
      }
      return true;
    }
    if (combo === 'b') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWordBackward();
      }
      return true;
    }
    if (combo === 'shift+w' || char === 'W') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWideWordForward();
      }
      return true;
    }
    if (combo === 'shift+b' || char === 'B') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWideWordBackward();
      }
      return true;
    }
    if (combo === 'e') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWordEnd();
      }
      return true;
    }
    if (combo === 'shift+e' || char === 'E') {
      const count = takeCount();
      for (let i = 0; i < count; i += 1) {
        deps.copyMode.moveWideWordEnd();
      }
      return true;
    }

    if (char === '0') {
      resetCount();
      deps.copyMode.moveToLineStart();
      return true;
    }
    if (char === '^') {
      resetCount();
      deps.copyMode.moveToLineFirstNonBlank();
      return true;
    }
    if (char === '$') {
      resetCount();
      deps.copyMode.moveToLineEnd();
      return true;
    }

    if (char === 'G' || combo === 'shift+g') {
      const count = takeCount();
      if (count > 1) {
        const cursor = getActiveCursor();
        if (cursor) {
          deps.copyMode.moveCursorTo({ x: cursor.x, absY: count - 1 });
        }
      } else {
        deps.copyMode.moveToBottom();
      }
      return true;
    }

    if (combo === 'pageup') {
      const count = takeCount();
      const rows = deps.copyMode.getViewportRows();
      deps.copyMode.moveCursorBy(0, -Math.max(1, rows - 1) * count);
      return true;
    }
    if (combo === 'pagedown') {
      const count = takeCount();
      const rows = deps.copyMode.getViewportRows();
      deps.copyMode.moveCursorBy(0, Math.max(1, rows - 1) * count);
      return true;
    }
    if (combo === 'ctrl+u') {
      const count = takeCount();
      const rows = deps.copyMode.getViewportRows();
      deps.copyMode.moveCursorBy(0, -Math.max(1, Math.floor(rows / 2)) * count);
      return true;
    }
    if (combo === 'ctrl+d') {
      const count = takeCount();
      const rows = deps.copyMode.getViewportRows();
      deps.copyMode.moveCursorBy(0, Math.max(1, Math.floor(rows / 2)) * count);
      return true;
    }

    resetCount();
    return true;
  };
}
