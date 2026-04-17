/**
 * Paste handler for App
 * Handles bracketed paste from host terminal
 */

import { decodePasteBytes, type PasteEvent } from '@opentui/core';

export interface PasteHandlerDeps {
  getFocusedPtyId: () => string | undefined;
  exitCopyMode?: () => void;
  writeToPTY: (ptyId: string, data: string) => void;
}

/**
 * Create paste handler
 */
export function createPasteHandler(deps: PasteHandlerDeps) {
  const { getFocusedPtyId, exitCopyMode, writeToPTY } = deps;

  /**
   * Handle bracketed paste from host terminal (Cmd+V sends this)
   */
  const handleBracketedPaste = (event: PasteEvent) => {
    // Exit copy mode if active so the pasted content is visible to the user
    exitCopyMode?.();
    // Write the pasted text directly to the focused pane's PTY
    const focusedPtyId = getFocusedPtyId();
    if (focusedPtyId) {
      writeToPTY(focusedPtyId, decodePasteBytes(event.bytes));
    }
  };

  return {
    handleBracketedPaste,
  };
}
