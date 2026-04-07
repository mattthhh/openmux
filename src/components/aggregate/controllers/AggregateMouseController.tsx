/**
 * AggregateMouseController - Handles all mouse interactions for AggregateView
 * Encapsulates preview pane mouse, drag-drop, selection, and scrollbar handling
 */

import { onCleanup } from 'solid-js';
import { createAggregateMouseHandlers } from '../mouse-handlers';
import type { MouseHandlerDeps } from '../mouse-handlers';

export interface AggregateMouseControllerProps extends MouseHandlerDeps {
  isActive: () => boolean;
}

/**
 * Controller component that manages all mouse interactions for AggregateView.
 * Sets up mouse handlers for preview pane, selection, and scrollbar dragging.
 */
export function AggregateMouseController(props: AggregateMouseControllerProps) {
  // Create mouse handlers with all dependencies
  const mouseHandlers = createAggregateMouseHandlers(props);

  // Cleanup mouse handler state
  onCleanup(() => {
    mouseHandlers.cleanup();
  });

  // Return mouse handlers for use by parent components
  return mouseHandlers;
}
