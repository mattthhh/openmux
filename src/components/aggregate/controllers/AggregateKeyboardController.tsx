/**
 * AggregateKeyboardController - Handles all keyboard input for AggregateView
 * Encapsulates vim mode, prefix keys, search mode, copy mode, and navigation
 */

import { createEffect, onCleanup } from 'solid-js';
import type { KeyboardEvent } from '../../../effect/bridge';
import { useOverlayKeyboardHandler } from '../../../contexts/keyboard/use-overlay-keyboard-handler';
import { createAggregateKeyboardHandler } from '../keyboard-handlers';
import type { AggregateKeyboardDeps } from '../keyboard/types';

export interface AggregateKeyboardControllerProps extends AggregateKeyboardDeps {
  isActive: () => boolean;
}

/**
 * Controller component that manages all keyboard interactions for AggregateView.
 * Sets up keyboard handlers and manages vim mode synchronization.
 */
export function AggregateKeyboardController(props: AggregateKeyboardControllerProps) {
  const { isActive, getVimEnabled, getVimMode, setVimMode, getInSearchMode, getPreviewMode } =
    props;

  // Create keyboard handler with all dependencies
  const keyboardHandler = createAggregateKeyboardHandler(props);

  // Vim mode sync effects
  createEffect(() => {
    if (!isActive() || !getVimEnabled()) return;
    if (getInSearchMode() || getPreviewMode()) {
      setVimMode('normal');
    }
  });

  // Register keyboard handler
  useOverlayKeyboardHandler({
    overlay: 'aggregateView',
    isActive,
    handler: keyboardHandler.handleKeyDown,
    ignoreRelease: false,
  });

  // Cleanup mouse handler state (optional cleanup from keyboard handler)
  onCleanup(() => {
    // Keyboard handlers don't hold resources, but mouse handlers might
  });

  // This is a logic-only controller, no visual output
  return null;
}
