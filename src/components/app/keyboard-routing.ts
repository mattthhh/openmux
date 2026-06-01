import { useKeyboard } from '@opentui/solid';
import type { KeyboardEvent } from '../../core/keyboard-event';
import type { OpenTuiKeyEvent } from './keyboard-utils';
import { normalizeKeyEvent } from './keyboard-utils';
import { handleSearchKeyboard } from './search-keyboard';
import { processNormalModeKey } from './key-processor';
import { routeKeyboardEventSync } from '../../effect/bridge';
import type { ResolvedKeybindingMap } from '../../core/keybindings';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { SearchState } from '../../contexts/search/types';
import type { VimInputMode } from '../../core/vim-sequences';

type VimSequenceHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export function setupKeyboardRouting(params: {
  config: { keybindings: () => { search: ResolvedKeybindingMap } };
  keyboardHandler: {
    mode: string;
    handleKeyDown: (event: KeyboardEvent) => boolean;
  };
  keyboardExitSearchMode: () => void;
  exitSearchMode: () => void;
  setSearchQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  getSearchState: () => SearchState | null;
  getVimEnabled: () => boolean;
  getSearchVimMode: () => VimInputMode;
  setSearchVimMode: (mode: VimInputMode) => void;
  getSearchVimHandler: () => VimSequenceHandler;
  clearAllSelections: () => void;
  getFocusedEmulator: () => ITerminalEmulator | null;
  writeToFocused: (data: string) => void;
  requestSnapToBottom: () => void;
  isOverlayActive: () => boolean;
  handleCopyModeKey: (event: KeyboardEvent) => void;
}) {
  const {
    config,
    keyboardHandler,
    keyboardExitSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState,
    getVimEnabled,
    getSearchVimMode,
    setSearchVimMode,
    getSearchVimHandler,
    clearAllSelections,
    getFocusedEmulator,
    writeToFocused,
    requestSnapToBottom,
    isOverlayActive,
    handleCopyModeKey,
  } = params;

  useKeyboard(
    async (event: OpenTuiKeyEvent) => {
      const normalizedEvent = normalizeKeyEvent(event);

      // Handle copy mode BEFORE async overlay routing to avoid:
      // 1. Microtask delays that can interleave event processing and drop inputs
      // 2. Overlay handlers accidentally consuming copy mode events
      if (keyboardHandler.mode === 'copy') {
        handleCopyModeKey(normalizedEvent);
        return;
      }

      // Handle search mode before async overlay routing for the same reasons
      if (keyboardHandler.mode === 'search') {
        handleSearchKeyboard(normalizedEvent, {
          exitSearchMode,
          keyboardExitSearchMode,
          setSearchQuery,
          nextMatch,
          prevMatch,
          getSearchState,
          keybindings: config.keybindings().search,
          vimEnabled: getVimEnabled,
          getVimMode: getSearchVimMode,
          setVimMode: setSearchVimMode,
          getVimHandler: getSearchVimHandler,
        });
        return;
      }

      // Route to overlays via KeyboardRouter (handles confirmation, session picker, aggregate view)
      // Use event.sequence for printable chars (handles shift for uppercase/symbols)
      // Fall back to event.name for special keys
      const charCode = normalizedEvent.sequence?.charCodeAt(0) ?? 0;
      const isPrintableChar =
        normalizedEvent.sequence?.length === 1 && charCode >= 32 && charCode < 127;
      const keyToPass = isPrintableChar ? normalizedEvent.sequence! : normalizedEvent.key;

      const routeResult = await routeKeyboardEventSync({
        key: keyToPass,
        ctrl: normalizedEvent.ctrl,
        alt: normalizedEvent.alt,
        shift: normalizedEvent.shift,
        sequence: normalizedEvent.sequence,
        baseCode: normalizedEvent.baseCode,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If an overlay handled the key, don't process further
      if (routeResult.handled) {
        return;
      }

      // First, check if this is a multiplexer command
      const handled = keyboardHandler.handleKeyDown({
        key: normalizedEvent.key,
        ctrl: normalizedEvent.ctrl,
        shift: normalizedEvent.shift,
        alt: normalizedEvent.alt,
        meta: normalizedEvent.meta,
        eventType: normalizedEvent.eventType,
        repeated: normalizedEvent.repeated,
      });

      // If not handled by multiplexer and in normal mode, forward to PTY
      if (!handled && keyboardHandler.mode === 'normal' && !isOverlayActive()) {
        processNormalModeKey(normalizedEvent, {
          clearAllSelections,
          getFocusedEmulator,
          writeToFocused,
          onKeyWrite: requestSnapToBottom,
        });
      }
    },
    { release: true }
  );
}
