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
 * Callback to synchronously update read throttles on focus change.
 * Set by the bridge layer to avoid circular imports.
 */
let readThrottleCallback:
  | ((ptyId: string, priority: 'focused' | 'background-visible') => void)
  | null = null;

/**
 * Set the currently focused PTY ID.
 * Called by the App component when focus changes.
 *
 * Immediately updates read throttles for both PTYs so the new focused
 * PTY starts reading at full speed and the old PTY pauses. Without this,
 * read throttle changes wait for SolidJS effect propagation (microtask
 * batch), which can be delayed by seconds under heavy output from the
 * previously-focused PTY's drain cycle.
 */
export function setFocusedPty(ptyId: string | null): void {
  if (ptyId === focusedPtyId) return;
  const previous = focusedPtyId;
  focusedPtyId = ptyId;
  focusChangeCallback?.(ptyId, previous);
  // Synchronously update read throttles so the new focused PTY reads data
  // immediately and the old PTY stops contending for event loop time.
  // The SolidJS effect in unified-subscription.ts also calls
  // applyPtyReadThrottle, but that may be delayed by the microtask chain.
  if (readThrottleCallback) {
    if (ptyId) {
      readThrottleCallback(ptyId, 'focused');
    }
    if (previous) {
      // Use background-visible — the SolidJS effect will correct this if
      // the PTY is actually hidden (different workspace).
      readThrottleCallback(previous, 'background-visible');
    }
  }
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

/** Get the currently focused PTY ID (for debugging/testing). */
export function getFocusedPtyId(): string | null {
  return focusedPtyId;
}

/** Reset the focused PTY registry (for testing). */
export function resetFocusedPtyRegistry(): void {
  focusedPtyId = null;
  clipboardPasteHandler = null;
  copyModeExitCallback = null;
  focusChangeCallback = null;
  readThrottleCallback = null;
}

/**
 * Register a callback invoked when the focused PTY changes.
 * Used by the visibility system to re-evaluate emulator update gating.
 */
export function onFocusChange(callback: FocusChangeCallback): void {
  focusChangeCallback = callback;
}

/**
 * Register a callback to synchronously update read throttles on focus change.
 * Called by the bridge layer during initialization.
 */
export function setReadThrottleCallback(
  callback: ((ptyId: string, priority: 'focused' | 'background-visible') => void) | null
): void {
  readThrottleCallback = callback;
}
