/**
 * Keyboard Router bridge functions (errore version)
 * Provides keyboard handler registration for overlays
 */

import type { KeyEvent, KeyHandler, OverlayType } from '../services/KeyboardRouter';
import { getKeyboardRouter, hasServices } from './services-instance';

export type { KeyEvent, KeyHandler, OverlayType } from '../services/KeyboardRouter';
export type { KeyboardEvent } from '../../core/keyboard-event';

/**
 * Register a keyboard handler for an overlay.
 * Returns an unsubscribe function.
 */
export function registerKeyboardHandler(overlay: OverlayType, handler: KeyHandler): () => void {
  if (!hasServices()) {
    console.warn('Services not initialized, keyboard handler not registered');
    return () => {};
  }
  return getKeyboardRouter().registerHandler(overlay, handler);
}

/**
 * Route a keyboard event to registered handlers.
 * Returns the overlay that handled the event, or null if not handled.
 */
export async function routeKeyboardEvent(
  event: KeyEvent
): Promise<{ handled: boolean; overlay: OverlayType | null }> {
  if (!hasServices()) {
    return { handled: false, overlay: null };
  }
  return await getKeyboardRouter().routeKey(event);
}

/**
 * Route a keyboard event synchronously.
 * (Same as routeKeyboardEvent - all operations are synchronous)
 */
export async function routeKeyboardEventSync(
  event: KeyEvent
): Promise<{ handled: boolean; overlay: OverlayType | null }> {
  if (!hasServices()) {
    return { handled: false, overlay: null };
  }
  return await getKeyboardRouter().routeKey(event);
}

/**
 * Get the currently active overlay.
 */
export function getActiveOverlay(): OverlayType | null {
  if (!hasServices()) {
    return null;
  }
  return getKeyboardRouter().getActiveOverlay();
}

/**
 * Check if a specific overlay has a registered handler.
 */
export function hasKeyboardHandler(overlay: OverlayType): boolean {
  if (!hasServices()) {
    return false;
  }
  return getKeyboardRouter().hasHandler(overlay);
}
