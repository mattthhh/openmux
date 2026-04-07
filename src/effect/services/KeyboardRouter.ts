/**
 * KeyboardRouter - Simple keyboard handler registration for overlays
 * Migrated to factory pattern with proper interface
 */

import type { KeyboardEvent } from '../../core/keyboard-event';

/** Keyboard event shape passed to handlers */
export type KeyEvent = KeyboardEvent;

/** Handler function type - returns true if event was handled (can be async) */
export type KeyHandler = (e: KeyEvent) => boolean | Promise<boolean>;

/** Overlay types that can register keyboard handlers */
export type OverlayType =
  | 'confirmationDialog'
  | 'commandPalette'
  | 'paneRename'
  | 'workspaceLabel'
  | 'templateOverlay'
  | 'sessionPicker'
  | 'aggregateView';

/** Priority determines which handler gets called first (higher = earlier) */
const OVERLAY_PRIORITY: Record<OverlayType, number> = {
  confirmationDialog: 30, // Highest - modal dialogs take precedence
  commandPalette: 25,
  paneRename: 24,
  workspaceLabel: 23,
  templateOverlay: 22,
  sessionPicker: 20,
  aggregateView: 10,
};

export interface KeyboardRouter {
  /** Register a keyboard handler for a key */
  register(key: string, handler: () => void): void;
  /** Unregister a keyboard handler */
  unregister(key: string): void;
  /** Route a keyboard input to registered handlers. Returns true if handled. */
  route(input: string): boolean;
  /** Register a handler for an overlay (returns unsubscribe function) */
  registerHandler(overlay: OverlayType, handler: KeyHandler): () => void;
  /** Route a keyboard event to registered overlay handlers */
  routeKey(event: KeyEvent): Promise<{ handled: boolean; overlay: OverlayType | null }>;
  /** Get the currently active overlay (highest priority with a handler) */
  getActiveOverlay(): OverlayType | null;
  /** Check if a specific overlay has a registered handler */
  hasHandler(overlay: OverlayType): boolean;
  /** Clear all handlers */
  clearAllHandlers(): void;
}

/** Create a KeyboardRouter instance */
export function createKeyboardRouter(): KeyboardRouter {
  // Simple key -> handler map for basic routing
  const keyHandlers = new Map<string, () => void>();
  // Overlay handlers map
  const overlayHandlers = new Map<OverlayType, KeyHandler>();

  const register = (key: string, handler: () => void): void => {
    keyHandlers.set(key, handler);
  };

  const unregister = (key: string): void => {
    keyHandlers.delete(key);
  };

  const route = (input: string): boolean => {
    const handler = keyHandlers.get(input);
    if (handler) {
      handler();
      return true;
    }
    return false;
  };

  const registerHandler = (overlay: OverlayType, handler: KeyHandler): (() => void) => {
    overlayHandlers.set(overlay, handler);
    return () => {
      overlayHandlers.delete(overlay);
    };
  };

  const routeKey = async (
    event: KeyEvent
  ): Promise<{ handled: boolean; overlay: OverlayType | null }> => {
    // Sort overlays by priority (highest first)
    const sortedOverlays = (Array.from(overlayHandlers.keys()) as OverlayType[]).sort(
      (a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a]
    );

    // Try each handler in priority order
    for (const overlay of sortedOverlays) {
      const handler = overlayHandlers.get(overlay);
      if (handler) {
        const handled = await handler(event);
        if (handled) {
          return { handled: true, overlay };
        }
      }
    }

    return { handled: false, overlay: null };
  };

  const getActiveOverlay = (): OverlayType | null => {
    const sortedOverlays = (Array.from(overlayHandlers.keys()) as OverlayType[]).sort(
      (a, b) => OVERLAY_PRIORITY[b] - OVERLAY_PRIORITY[a]
    );
    return sortedOverlays[0] ?? null;
  };

  const hasHandler = (overlay: OverlayType): boolean => {
    return overlayHandlers.has(overlay);
  };

  const clearAllHandlers = (): void => {
    keyHandlers.clear();
    overlayHandlers.clear();
  };

  return {
    register,
    unregister,
    route,
    registerHandler,
    routeKey,
    getActiveOverlay,
    hasHandler,
    clearAllHandlers,
  };
}

/** Global router instance for backward compatibility */
let globalRouter: KeyboardRouter | null = null;

/** Get or create the global KeyboardRouter instance */
export function getGlobalKeyboardRouter(): KeyboardRouter {
  if (!globalRouter) {
    globalRouter = createKeyboardRouter();
  }
  return globalRouter;
}

// These use the global router instance

/** Register a keyboard handler for an overlay. Returns an unsubscribe function. */
export function registerHandler(overlay: OverlayType, handler: KeyHandler): () => void {
  return getGlobalKeyboardRouter().registerHandler(overlay, handler);
}

/** Route a keyboard event to registered handlers. */
export async function routeKey(
  event: KeyEvent
): Promise<{ handled: boolean; overlay: OverlayType | null }> {
  return getGlobalKeyboardRouter().routeKey(event);
}

/** Get the currently active overlay (highest priority with a handler). */
export function getActiveOverlay(): OverlayType | null {
  return getGlobalKeyboardRouter().getActiveOverlay();
}

/** Check if a specific overlay has a registered handler. */
export function hasHandler(overlay: OverlayType): boolean {
  return getGlobalKeyboardRouter().hasHandler(overlay);
}

/** Clear all handlers (useful for testing) */
export function clearAllHandlers(): void {
  return getGlobalKeyboardRouter().clearAllHandlers();
}
