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
    // Ignore empty paste events that can reach us if the terminal emitted a
    // bracketed paste sequence with no content. Writing an empty string to
    // the native PTY layer can trigger an ArrayBufferView length error.
    if (!event.bytes || event.bytes.length === 0) return;

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
