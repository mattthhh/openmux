/**
 * Keyboard Router bridge functions (errore version)
 * Provides keyboard handler registration for overlays
 * 
 * Directly uses KeyboardRouter interface without Effect runtime.
 */

import type { KeyboardRouter, KeyEvent, KeyHandler, OverlayType } from "../services/KeyboardRouter"
import { getKeyboardRouter, hasServices } from "./services-instance"

export type { KeyEvent, KeyHandler, OverlayType } from "../services/KeyboardRouter"
export type { KeyboardEvent } from "../../core/keyboard-event"

/**
 * Register a keyboard handler for an overlay.
 * Returns an unsubscribe function.
 * 
 * Backward-compatible version that uses global services singleton.
 */
export function registerKeyboardHandler(
  overlay: OverlayType,
  handler: KeyHandler
): () => void {
  if (!hasServices()) {
    console.warn("Services not initialized, keyboard handler not registered")
    return () => {}
  }
  return getKeyboardRouter().registerHandler(overlay, handler)
}

/**
 * Register a keyboard handler for an overlay with explicit service.
 * Returns an unsubscribe function.
 */
export function registerKeyboardHandlerWithService(
  router: KeyboardRouter,
  overlay: OverlayType,
  handler: KeyHandler
): () => void {
  return router.registerHandler(overlay, handler)
}

/**
 * Route a keyboard event to registered handlers.
 * Returns the overlay that handled the event, or null if not handled.
 * 
 * Backward-compatible version that uses global services singleton.
 */
export function routeKeyboardEvent(
  event: KeyEvent
): { handled: boolean; overlay: OverlayType | null } {
  if (!hasServices()) {
    return { handled: false, overlay: null }
  }
  return getKeyboardRouter().routeKey(event)
}

/**
 * Route a keyboard event synchronously.
 * (Same as routeKeyboardEvent - all operations are synchronous)
 * 
 * Backward-compatible version that uses global services singleton.
 */
export function routeKeyboardEventSync(
  event: KeyEvent
): { handled: boolean; overlay: OverlayType | null } {
  if (!hasServices()) {
    return { handled: false, overlay: null }
  }
  return getKeyboardRouter().routeKey(event)
}

/**
 * Route a keyboard event with explicit service.
 */
export function routeKeyboardEventSyncWithService(
  router: KeyboardRouter,
  event: KeyEvent
): { handled: boolean; overlay: OverlayType | null } {
  return router.routeKey(event)
}

/**
 * Get the currently active overlay.
 * 
 * Backward-compatible version that uses global services singleton.
 */
export function getActiveOverlay(): OverlayType | null {
  if (!hasServices()) {
    return null
  }
  return getKeyboardRouter().getActiveOverlay()
}

/**
 * Get the currently active overlay with explicit service.
 */
export function getActiveOverlayWithService(router: KeyboardRouter): OverlayType | null {
  return router.getActiveOverlay()
}

/**
 * Check if a specific overlay has a registered handler.
 * 
 * Backward-compatible version that uses global services singleton.
 */
export function hasKeyboardHandler(overlay: OverlayType): boolean {
  if (!hasServices()) {
    return false
  }
  return getKeyboardRouter().hasHandler(overlay)
}

/**
 * Check if a specific overlay has a registered handler with explicit service.
 */
export function hasKeyboardHandlerWithService(router: KeyboardRouter, overlay: OverlayType): boolean {
  return router.hasHandler(overlay)
}
