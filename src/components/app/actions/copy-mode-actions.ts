/**
 * Copy mode action handlers.
 *
 * Encapsulates enter/exit copy mode, vim state, key handling,
 * and the bracketed-paste exit callback wiring.
 */

import { createEffect } from 'solid-js';
import { createCopyModeVimState } from '../copy-mode-vim';
import { createCopyModeKeyHandler } from '../copy-mode-keyboard';
import { setCopyModeExitCallback } from '../../../terminal/focused-pty-registry';
import type { useConfig } from '../../../contexts/ConfigContext';
import type { CopyModeContextValue } from '../../../contexts/copy-mode/types';
import type { KeyboardContextValue } from '../../../contexts/keyboard/types';
import type { SelectionContextValue } from '../../../contexts/SelectionContext';
import type { KeyboardEvent } from '../../../core/keyboard-event';

type VimHandler = {
  handleCombo: (combo: string) => { action: string | null; pending: boolean };
  reset: () => void;
};

export interface CopyModeActionsDeps {
  config: ReturnType<typeof useConfig>;
  keyboardState: KeyboardContextValue;
  copyMode: CopyModeContextValue;
  selection: SelectionContextValue;
  getActivePtyId: () => string | undefined;
  pasteCallback: () => void;
}

export interface CopyModeActions {
  handleEnterCopyMode: () => void;
  handleExitCopyMode: () => void;
  handleCopyModeKey: (event: KeyboardEvent) => void;
  getCopyVimHandler: () => VimHandler;
}

export function createCopyModeActions(deps: CopyModeActionsDeps): CopyModeActions {
  const { config, keyboardState, copyMode, selection, getActivePtyId, pasteCallback } = deps;

  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => keyboardState.state.mode === 'copy',
  });

  const handleExitCopyMode = () => {
    copyMode.exitCopyMode();
    keyboardState.exitCopyMode();
  };

  // Wire copy mode exit so bracketed paste can exit copy mode before pasting
  createEffect(() => {
    const active = keyboardState.state.mode === 'copy';
    setCopyModeExitCallback(active ? handleExitCopyMode : null);
  });

  const handleEnterCopyMode = () => {
    selection.clearAllSelections();
    const focusedPtyId = getActivePtyId();
    if (!focusedPtyId) {
      keyboardState.exitCopyMode();
      return;
    }
    copyMode.enterCopyMode(focusedPtyId);
  };

  const handleCopyModeKey = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: handleExitCopyMode,
    pasteCallback,
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  return {
    handleEnterCopyMode,
    handleExitCopyMode,
    handleCopyModeKey,
    getCopyVimHandler: copyModeVimState.getCopyVimHandler,
  };
}
