/**
 * Focused PTY Registry (Clipboard Passthrough with Fallback)
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
 * The handler returns true if clipboard read succeeded (stdin data can be
 * discarded) or false if it failed (stdin data should be used as fallback).
 * This fallback enables paste over SSH where the server clipboard is empty.
 */

import { createSignal } from 'solid-js';

/**
 * Clipboard paste handler function type.
 * Called when paste is triggered (paste start marker detected in stdin).
 * Implementation should:
 * 1. Read from system clipboard
 * 2. If clipboard has content, write it to PTY and return true
 * 3. If clipboard is empty/unavailable, return false to trigger stdin fallback
 */
type ClipboardPasteHandler = (ptyId: string) => Promise<boolean> | boolean;

/** Callback invoked before clipboard paste to exit copy mode if active */
type CopyModeExitCallback = () => void;

let focusedPtyId: string | null = null;
// Signal mirror of focusedPtyId so reactive scopes can re-run when the
// registry changes. The registry is written from a SolidJS effect
// (setupFocusedPtyRegistry) that has no ordering guarantee relative to
// other effects reading it via getFocusedPtyId() — consumers that gate
// behavior on the focused PTY must track this signal to converge.
const [focusedPtyIdSignal, setFocusedPtyIdSignal] = createSignal<string | null>(null);
let clipboardPasteHandler: ClipboardPasteHandler | null = null;
let copyModeExitCallback: CopyModeExitCallback | null = null;
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
  setFocusedPtyIdSignal(ptyId);
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
 * Returns true if clipboard paste was triggered and succeeded,
 * false if no focused PTY/handler or if clipboard read failed
 * (caller should fall back to stdin paste data).
 */
export function triggerClipboardPaste(): Promise<boolean> | boolean {
  if (focusedPtyId && clipboardPasteHandler) {
    // Exit copy mode if active so the pasted content is visible to the user
    copyModeExitCallback?.();
    return clipboardPasteHandler(focusedPtyId);
  }
  return false;
}

/** Get the currently focused PTY ID (for debugging/testing). */
export function getFocusedPtyId(): string | null {
  return focusedPtyId;
}

/**
 * Reactive accessor for the focused PTY ID. Reading this inside a SolidJS
 * tracking scope subscribes it to focus changes — use this (not
 * getFocusedPtyId) in effects that must re-evaluate when focus moves.
 */
export function observeFocusedPtyId(): string | null {
  return focusedPtyIdSignal();
}

/** Reset the focused PTY registry (for testing). */
export function resetFocusedPtyRegistry(): void {
  focusedPtyId = null;
  setFocusedPtyIdSignal(null);
  clipboardPasteHandler = null;
  copyModeExitCallback = null;
  readThrottleCallback = null;
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
