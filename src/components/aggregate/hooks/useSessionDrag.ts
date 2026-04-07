/**
 * useSessionDrag - Hook for managing session drag-and-drop reordering in AggregateView.
 *
 * Provides state management for dragging sessions to reorder them in the aggregate
 * view list. Handles drag start, target tracking, and commit/cancel operations.
 */

import { createSignal, type Accessor } from 'solid-js';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { FlattenedTreeItem } from '../../../contexts/aggregate-view-types';

/** Drag state information */
export interface DragState {
  /** ID of the session being dragged, or null if not dragging */
  draggingId: string | null;
  /** ID of the session currently under the drag target */
  targetId: string | null;
  /** Whether an actual drag has occurred (vs just a click) */
  didDrag: boolean;
  /** Whether to suppress toggle actions during drag */
  suppressToggle: boolean;
}

/** Result of useSessionDrag hook */
interface UseSessionDragResult {
  /** Current drag state */
  state: Accessor<DragState>;
  /** ID of session being dragged */
  draggingId: Accessor<string | null>;
  /** ID of current drag target session */
  targetId: Accessor<string | null>;
  /** Whether an actual drag has occurred */
  didDrag: Accessor<boolean>;
  /** Whether toggle should be suppressed */
  suppressToggle: Accessor<boolean>;
  /** Start dragging a session */
  beginDrag: (sessionId: string) => void;
  /** Update drag target based on mouse position */
  updateTarget: (
    event: OpenTUIMouseEvent,
    getItemAtMouse: (e: OpenTUIMouseEvent) => FlattenedTreeItem | undefined
  ) => void;
  /** Commit the drag (perform reorder if needed) */
  commitDrag: (onReorder?: (sourceId: string, targetId: string) => Promise<void>) => Promise<void>;
  /** Cancel the current drag without committing */
  cancelDrag: () => void;
}

/**
 * Extract session ID from a flattened tree item.
 */
function getSessionIdFromItem(item: FlattenedTreeItem | undefined): string | null {
  if (!item) return null;

  switch (item.node.type) {
    case 'session':
      return item.node.session.id;
    case 'pty':
      return item.node.ptyInfo.sessionId;
    case 'placeholder':
      return item.node.parentSessionId;
    default:
      return null;
  }
}

/**
 * Hook for managing session drag-and-drop state.
 *
 * @returns UseSessionDragResult with drag state and operations
 *
 * @example
 * ```tsx
 * const drag = useSessionDrag();
 *
 * // On mouse down on a session:
 * drag.beginDrag(sessionId);
 *
 * // On mouse drag:
 * drag.updateTarget(event, getItemAtMouse);
 *
 * // On mouse up:
 * await drag.commitDrag(async (sourceId, targetId) => {
 *   await reorderSessions(sourceId, targetId);
 * });
 *
 * // Check if dragging:
 * if (drag.draggingId()) {
 *   // Show drag indicator
 * }
 * ```
 */
export function useSessionDrag(): UseSessionDragResult {
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [targetId, setTargetId] = createSignal<string | null>(null);
  const [didDrag, setDidDrag] = createSignal(false);
  const [suppressToggle, setSuppressToggle] = createSignal(false);

  /**
   * Start dragging a session.
   */
  const beginDrag = (sessionId: string): void => {
    setDraggingId(sessionId);
    setTargetId(sessionId); // Initially target is self
    setDidDrag(false);
    setSuppressToggle(false);
  };

  /**
   * Update drag target based on mouse position.
   */
  const updateTarget = (
    event: OpenTUIMouseEvent,
    getItemAtMouse: (e: OpenTUIMouseEvent) => FlattenedTreeItem | undefined
  ): void => {
    const sourceId = draggingId();
    if (!sourceId) return;

    const item = getItemAtMouse(event);
    const newTargetId = getSessionIdFromItem(item);

    if (!newTargetId) return;

    setTargetId(newTargetId);

    // Mark as actual drag if target differs from source
    if (newTargetId !== sourceId) {
      setDidDrag(true);
      setSuppressToggle(true);
    }
  };

  /**
   * Commit the drag operation.
   */
  const commitDrag = async (
    onReorder?: (sourceId: string, targetId: string) => Promise<void>
  ): Promise<void> => {
    const sourceId = draggingId();
    const finalTargetId = targetId();
    const hasDragged = didDrag();

    const shouldReorder = hasDragged && sourceId && finalTargetId && sourceId !== finalTargetId;

    // Clear drag state first
    setDraggingId(null);
    setTargetId(null);
    setDidDrag(false);

    // Delay clearing suppressToggle to prevent accidental toggles
    if (hasDragged) {
      setTimeout(() => {
        setSuppressToggle(false);
      }, 0);
    } else {
      setSuppressToggle(false);
    }

    // Perform reorder if needed
    if (shouldReorder && onReorder) {
      await onReorder(sourceId, finalTargetId);
    }
  };

  /**
   * Cancel the current drag without committing.
   */
  const cancelDrag = (): void => {
    setDraggingId(null);
    setTargetId(null);
    setDidDrag(false);
    setSuppressToggle(false);
  };

  /**
   * Get combined state object.
   */
  const state: Accessor<DragState> = () => ({
    draggingId: draggingId(),
    targetId: targetId(),
    didDrag: didDrag(),
    suppressToggle: suppressToggle(),
  });

  return {
    state,
    draggingId,
    targetId,
    didDrag,
    suppressToggle,
    beginDrag,
    updateTarget,
    commitDrag,
    cancelDrag,
  };
}
