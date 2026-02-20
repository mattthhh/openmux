/**
 * Overlay keyboard handler hook.
 * Registers a KeyboardRouter handler with optional release-event suppression.
 */

import { createEffect, onCleanup } from 'solid-js';
import {
  registerKeyboardHandler,
  type KeyboardEvent,
  type KeyHandler,
  type OverlayType,
} from '../../effect/bridge';

type OverlayKeyboardHandlerOptions = {
  overlay: OverlayType;
  isActive: () => boolean;
  handler: (event: KeyboardEvent) => boolean | Promise<boolean>;
  ignoreRelease?: boolean;
};

export function useOverlayKeyboardHandler(options: OverlayKeyboardHandlerOptions): void {
  const { overlay, isActive, handler } = options;
  const ignoreRelease = options.ignoreRelease ?? true;

  createEffect(() => {
    const wrapped: KeyHandler = async (event) => {
      if (!isActive()) return false;
      if (ignoreRelease && event.eventType === 'release') return true;
      return await handler(event);
    };

    const unsubscribe = registerKeyboardHandler(overlay, wrapped);
    onCleanup(() => unsubscribe());
  });
}
