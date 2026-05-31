/**
 * Focused PTY Registry (Clipboard Passthrough)
 *
 * A simple singleton registry that tracks the currently focused PTY and
 * provides a way to trigger clipboard paste to it. This is used by the
 * paste-intercepting stdin wrapper to read from clipboard and write to PTY.
 *
 * This pattern is necessary because:
 * 1. The paste interception happens at the stdin level (outside React)
 * 2. The PTY information lives in the SolidJS context (inside React)
 * 3. We need a bridge between these two worlds
 *
 * Key insight: We DON'T pass stdin paste data through this registry.
 * Instead, the handler reads from the system clipboard directly, which
 * is always complete (no chunking issues).
 */

/**
 * Clipboard paste handler function type.
 * Called when paste is triggered (paste start marker detected in stdin).
 * Implementation should:
 * 1. Read from system clipboard (always complete)
 * 2. Check if child app has mode 2004 enabled
 * 3. Wrap with bracketed paste markers if needed
 * 4. Write atomically to PTY
 */
type ClipboardPasteHandler = (ptyId: string) => void;

/** Callback invoked before clipboard paste to exit copy mode if active */
type CopyModeExitCallback = () => void;

type FocusChangeCallback = (focusedPtyId: string | null, previousPtyId: string | null) => void;

let focusedPtyId: string | null = null;
let clipboardPasteHandler: ClipboardPasteHandler | null = null;
let copyModeExitCallback: CopyModeExitCallback | null = null;
let focusChangeCallback: FocusChangeCallback | null = null;

/**
 * Set the currently focused PTY ID.
 * Called by the App component when focus changes.
 */
export function setFocusedPty(ptyId: string | null): void {
  if (ptyId === focusedPtyId) return;
  const previous = focusedPtyId;
  focusedPtyId = ptyId;
  focusChangeCallback?.(ptyId, previous);
}

/**
 * Set the clipboard paste handler function.
 * Called by the App component on mount.
 * The handler should read from clipboard and write to PTY.
 */
export function setClipboardPasteHandler(handler: ClipboardPasteHandler): void {
  clipboardPasteHandler = handler;
}

/**
 * Set a callback that exits copy mode before pasting.
 * Called when a bracketed paste arrives while copy mode is active.
 */
export function setCopyModeExitCallback(callback: CopyModeExitCallback | null): void {
  copyModeExitCallback = callback;
}

/**
 * Trigger clipboard paste to the currently focused PTY.
 * Called when paste start marker is detected in stdin.
 * Returns true if paste was triggered, false if no focused PTY or handler.
 */
export function triggerClipboardPaste(): boolean {
  if (focusedPtyId && clipboardPasteHandler) {
    // Exit copy mode if active so the pasted content is visible to the user
    copyModeExitCallback?.();
    clipboardPasteHandler(focusedPtyId);
    return true;
  }
  return false;
}

/**
 * Get the currently focused PTY ID (for debugging/testing).
 */
export function getFocusedPtyId(): string | null {
  return focusedPtyId;
}

/**
 * Register a callback invoked when the focused PTY changes.
 * Used by the visibility system to re-evaluate emulator update gating.
 */
export function onFocusChange(callback: FocusChangeCallback): void {
  focusChangeCallback = callback;
}
