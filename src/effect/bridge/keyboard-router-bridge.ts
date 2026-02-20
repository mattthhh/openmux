import * as KeyboardRouter from "../services/KeyboardRouter"

export type { KeyEvent, KeyHandler, OverlayType } from "../services/KeyboardRouter"
export type { KeyboardEvent } from "../../core/keyboard-event"

/**
 * Register a keyboard handler for an overlay.
 * Returns an unsubscribe function.
 */
export function registerKeyboardHandler(
  overlay: KeyboardRouter.OverlayType,
  handler: KeyboardRouter.KeyHandler
): () => void {
  return KeyboardRouter.registerHandler(overlay, handler)
}

/**
 * Route a keyboard event to registered handlers.
 * Returns the overlay that handled the event, or null if not handled.
 */
export function routeKeyboardEvent(
  event: KeyboardRouter.KeyEvent
): { handled: boolean; overlay: KeyboardRouter.OverlayType | null } {
  return KeyboardRouter.routeKey(event)
}

/**
 * Route a keyboard event synchronously.
 * (Same as routeKeyboardEvent - all operations are now synchronous)
 */
export function routeKeyboardEventSync(
  event: KeyboardRouter.KeyEvent
): { handled: boolean; overlay: KeyboardRouter.OverlayType | null } {
  return KeyboardRouter.routeKey(event)
}

/**
 * Get the currently active overlay.
 */
export function getActiveOverlay(): KeyboardRouter.OverlayType | null {
  return KeyboardRouter.getActiveOverlay()
}

/**
 * Check if a specific overlay has a registered handler.
 */
export function hasKeyboardHandler(overlay: KeyboardRouter.OverlayType): boolean {
  return KeyboardRouter.hasHandler(overlay)
}
