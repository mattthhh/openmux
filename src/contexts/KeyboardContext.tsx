/**
 * Keyboard context for prefix-key system and mode management
 *
 * Module structure:
 * - keyboard/types.ts: Type definitions
 * - keyboard/handlers.ts: Key handler functions
 */

import { createContext, useContext, createEffect, onCleanup, type ParentProps } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { KeyboardState, ConfirmationType } from '../core/types';
import { useLayout } from './LayoutContext';
import type { KeyboardContextValue, KeyboardHandlerOptions } from './keyboard/types';
import {
  handleNormalModeAction,
  handlePrefixModeAction,
  handleMoveModeAction,
} from './keyboard/handlers';
import { useConfig } from './ConfigContext';
import { eventToCombo, matchKeybinding } from '../core/keybindings';
import type { KeyboardEvent } from '../core/keyboard-event';

export type { KeyboardContextValue, KeyboardHandlerOptions } from './keyboard/types';

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

interface KeyboardProviderProps extends ParentProps {}

export function KeyboardProvider(props: KeyboardProviderProps) {
  const config = useConfig();
  const initialState: KeyboardState = {
    mode: 'normal',
  };

  const [state, setState] = createStore<KeyboardState>(initialState);

  // Prefix mode timeout
  createEffect(() => {
    const timeoutMs = config.keybindings().prefixTimeoutMs;
    if (state.mode !== 'prefix' || !state.prefixActivatedAt) return;

    const timeout = setTimeout(() => {
      setState(
        produce((s) => {
          s.mode = 'normal';
          s.prefixActivatedAt = undefined;
        })
      );
    }, timeoutMs);

    onCleanup(() => clearTimeout(timeout));
  });

  const enterPrefixMode = () => {
    setState(
      produce((s) => {
        s.mode = 'prefix';
        s.prefixActivatedAt = Date.now();
      })
    );
  };

  const exitPrefixMode = () => {
    setState(
      produce((s) => {
        s.mode = 'normal';
        s.prefixActivatedAt = undefined;
      })
    );
  };

  const enterSearchMode = () => {
    setState(
      produce((s) => {
        s.mode = 'search';
        s.prefixActivatedAt = undefined;
      })
    );
  };

  const exitSearchMode = () => {
    setState('mode', 'normal');
  };

  const enterCopyMode = () => {
    setState(
      produce((s) => {
        s.mode = 'copy';
        s.prefixActivatedAt = undefined;
      })
    );
  };

  const exitCopyMode = () => {
    setState('mode', 'normal');
  };

  const enterAggregateMode = () => {
    setState(
      produce((s) => {
        s.mode = 'aggregate';
        s.prefixActivatedAt = undefined;
      })
    );
  };

  const exitAggregateMode = () => {
    setState('mode', 'normal');
  };

  const enterMoveMode = () => {
    setState(
      produce((s) => {
        s.mode = 'move';
        s.prefixActivatedAt = undefined;
      })
    );
  };

  const exitMoveMode = () => {
    setState('mode', 'normal');
  };

  const enterConfirmMode = (confirmationType: ConfirmationType) => {
    setState(
      produce((s) => {
        s.mode = 'confirm';
        s.prefixActivatedAt = undefined;
        s.confirmationType = confirmationType;
      })
    );
  };

  const exitConfirmMode = () => {
    setState(
      produce((s) => {
        s.mode = 'normal';
        s.confirmationType = undefined;
      })
    );
  };

  const value: KeyboardContextValue = {
    state,
    enterPrefixMode,
    exitPrefixMode,
    enterSearchMode,
    exitSearchMode,
    enterCopyMode,
    exitCopyMode,
    enterAggregateMode,
    exitAggregateMode,
    enterMoveMode,
    exitMoveMode,
    enterConfirmMode,
    exitConfirmMode,
  };

  return <KeyboardContext.Provider value={value}>{props.children}</KeyboardContext.Provider>;
}

export function useKeyboard(): KeyboardContextValue {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used within KeyboardProvider');
  }
  return context;
}

/**
 * Hook for handling keyboard input across all modes
 */
export function useKeyboardHandler(options: KeyboardHandlerOptions = {}) {
  const keyboard = useKeyboard();
  const layout = useLayout();
  const config = useConfig();

  const handleKeyDown = (event: KeyboardEvent) => {
    const { key, ctrl, alt, shift, meta } = event;
    const keybindings = config.keybindings();
    const keyEvent = { key, ctrl, alt, shift, meta };

    if (event.eventType === 'release') {
      return false;
    }

    // Note: We do NOT intercept Ctrl+V here. Applications like Claude Code need to
    // receive Ctrl+V directly so they can trigger their own clipboard reading (which
    // supports images). For text paste, use prefix+] or prefix+p, or Cmd+V on macOS
    // (which triggers bracketed paste via PasteEvent handled in App.tsx).

    // Handle prefix key (only in normal mode)
    if (keyboard.state.mode === 'normal' && eventToCombo(keyEvent) === keybindings.prefixKey) {
      keyboard.enterPrefixMode();
      return true;
    }

    // Prefix mode commands
    if (keyboard.state.mode === 'prefix') {
      const action = matchKeybinding(keybindings.prefix, keyEvent);
      return action
        ? handlePrefixModeAction(
            action,
            keyboard,
            layout,
            layout.activeWorkspace.layoutMode,
            options
          )
        : false;
    }

    if (keyboard.state.mode === 'move') {
      const action = matchKeybinding(keybindings.move, keyEvent);
      if (action) {
        return handleMoveModeAction(action, keyboard, layout);
      }
      keyboard.exitMoveMode();
      return true;
    }

    if (keyboard.state.mode === 'normal') {
      // Skip non-prefix shortcuts when prefixOnly mode is enabled
      if (config.config().keyboard.prefixOnly) {
        return false;
      }

      const action = matchKeybinding(keybindings.normal, keyEvent);
      if (!action) return false;

      return handleNormalModeAction(
        action,
        keyboard,
        layout,
        layout.activeWorkspace.layoutMode,
        options
      );
    }

    // Normal mode - pass through to terminal
    return false;
  };

  return {
    handleKeyDown,
    get mode() {
      return keyboard.state.mode;
    },
  };
}
