/**
 * Keyboard context for prefix-key system and mode management
 *
 * Module structure:
 * - keyboard/types.ts: Type definitions
 * - keyboard/handlers.ts: Key handler functions
 */

import { createContext, useContext, createEffect, onCleanup, type ParentProps } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { KeyboardState } from '../core/types';
import { useLayout } from './LayoutContext';
import type { KeyboardContextValue, KeyboardHandlerOptions } from './keyboard/types';
import {
  handleNormalModeAction,
  handlePrefixModeAction,
  handleMoveModeAction,
} from './keyboard/handlers';
import {
  createConfirmModeHandlers,
  createModeTransitionHandlers,
  createPrefixModeHandlers,
} from './keyboard/mode-transitions';
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

  const prefixMode = createPrefixModeHandlers(setState);
  const searchMode = createModeTransitionHandlers(setState, 'search');
  const copyMode = createModeTransitionHandlers(setState, 'copy');
  const aggregateMode = createModeTransitionHandlers(setState, 'aggregate');
  const moveMode = createModeTransitionHandlers(setState, 'move');
  const confirmMode = createConfirmModeHandlers(setState);

  const value: KeyboardContextValue = {
    state,
    enterPrefixMode: prefixMode.enter,
    exitPrefixMode: prefixMode.exit,
    enterSearchMode: searchMode.enter,
    exitSearchMode: searchMode.exit,
    enterCopyMode: copyMode.enter,
    exitCopyMode: copyMode.exit,
    enterAggregateMode: aggregateMode.enter,
    exitAggregateMode: aggregateMode.exit,
    enterMoveMode: moveMode.enter,
    exitMoveMode: moveMode.exit,
    enterConfirmMode: confirmMode.enter,
    exitConfirmMode: confirmMode.exit,
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
