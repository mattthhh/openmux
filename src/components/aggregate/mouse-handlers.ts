/**
 * Mouse handlers for AggregateView preview pane
 * Uses shared terminal mouse handling logic
 */

import { type MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { writeToPty } from '../../effect/bridge';
import { inputHandler } from '../../terminal/input-handler';
import {
  createTerminalMouseHandler,
  type TerminalMouseDeps,
} from '../shared/terminal-mouse-handler';

export interface MouseHandlerDeps extends TerminalMouseDeps {
  getPreviewMode: () => boolean;
  getSelectedPtyId: () => string | null;

  getListPaneWidth: () => number;
  getPreviewInnerWidth: () => number;
  getPreviewInnerHeight: () => number;
  setScrollOffset: (ptyId: string, offset: number) => void;
}

/**
 * Creates mouse handlers for AggregateView preview pane
 */
export function createAggregateMouseHandlers(deps: MouseHandlerDeps) {
  const {
    getPreviewMode,
    getSelectedPtyId,
    getListPaneWidth,
    getPreviewInnerWidth,
    getPreviewInnerHeight,
    getScrollState,
    scrollTerminal,
    setScrollOffset,
  } = deps;

  const mouseHandler = createTerminalMouseHandler(deps);

  // Track scrollbar drag state (preview pane specific)
  let scrollbarDrag = {
    isDragging: false,
    startY: 0,
    startOffset: 0,
  };

  /**
   * Check if a position is on the scrollbar (rightmost column when scrolled)
   */
  const isOnScrollbar = (ptyId: string, relX: number, relY: number): boolean => {
    const scrollState = getScrollState(ptyId);
    // Scrollbar is shown when not at bottom
    if (!scrollState || scrollState.isAtBottom) return false;
    // Scrollbar is on the rightmost column
    const innerWidth = getPreviewInnerWidth();
    return relX === innerWidth - 1 && relY >= 0 && relY < getPreviewInnerHeight();
  };

  /**
   * Convert Y position to scroll offset
   */
  const yToScrollOffset = (ptyId: string, relY: number): number => {
    const scrollState = getScrollState(ptyId);
    if (!scrollState || scrollState.scrollbackLength === 0) return 0;
    const innerHeight = getPreviewInnerHeight();
    // relY 0 = top = max offset, relY (innerHeight-1) = bottom = 0 offset
    const ratio = 1 - relY / Math.max(1, innerHeight - 1);
    return Math.round(ratio * scrollState.scrollbackLength);
  };

  type ScrollDirection = 'up' | 'down' | 'left' | 'right';

  const scrollDirectionToButton = (direction: ScrollDirection): number => {
    switch (direction) {
      case 'up':
        return 4;
      case 'down':
        return 5;
      case 'left':
        return 6;
      case 'right':
        return 7;
    }
  };

  /**
   * Check if terminal is scrolled back (not at bottom)
   */
  const isScrolledBack = (ptyId: string): boolean => {
    const scrollState = getScrollState(ptyId);
    return scrollState ? scrollState.viewportOffset > 0 : false;
  };

  /**
   * Calculate coordinates relative to preview content area
   */
  const getRelativeCoords = (event: OpenTUIMouseEvent) => {
    const previewX = getListPaneWidth();
    const relX = event.x - previewX - 1;
    const relY = event.y - 1; // Account for border
    return { relX, relY };
  };

  /**
   * Check if coordinates are inside the content area
   */
  const isInsideContent = (relX: number, relY: number) => {
    return (
      relX >= 0 && relY >= 0 && relX < getPreviewInnerWidth() && relY < getPreviewInnerHeight()
    );
  };

  /**
   * Forward mouse event to PTY
   */
  const forwardMouseEvent = (
    ptyId: string,
    event: OpenTUIMouseEvent,
    type: 'down' | 'up' | 'move' | 'drag',
    relX: number,
    relY: number
  ) => {
    const sequence = inputHandler.encodeMouse({
      type,
      button: event.button,
      x: relX,
      y: relY,
      shift: event.modifiers?.shift,
      alt: event.modifiers?.alt,
      ctrl: event.modifiers?.ctrl,
    });
    writeToPty(ptyId, sequence);
  };

  const handlePreviewMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    // Check if clicking on scrollbar
    if (isOnScrollbar(ptyId, relX, relY)) {
      const scrollState = getScrollState(ptyId);
      scrollbarDrag = {
        isDragging: true,
        startY: relY,
        startOffset: scrollState?.viewportOffset ?? 0,
      };
      // Jump to clicked position
      setScrollOffset(ptyId, yToScrollOffset(ptyId, relY));
      return;
    }

    // Try selection first
    const handled = mouseHandler.handleSelectionMouseDown(
      ptyId,
      relX,
      relY,
      event.modifiers?.shift ?? false
    );
    if (handled) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward mouse down when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    forwardMouseEvent(ptyId, event, 'down', relX, relY);
  };

  const handlePreviewMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    // End scrollbar drag
    scrollbarDrag.isDragging = false;

    const ptyId = getSelectedPtyId();

    // Always try to complete selection (handles cleanup)
    if (ptyId && mouseHandler.handleSelectionMouseUp(ptyId)) {
      return;
    }

    if (!getPreviewMode() || !ptyId) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward mouse up when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(ptyId, event, 'up', relX, relY);
  };

  const handlePreviewMouseMove = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    if (!getPreviewMode()) return;

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    // Only forward mouse move if app explicitly wants mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    forwardMouseEvent(ptyId, event, 'move', relX, relY);
  };

  const handlePreviewMouseDrag = (event: OpenTUIMouseEvent) => {
    event.preventDefault();

    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);

    // Handle scrollbar dragging
    if (scrollbarDrag.isDragging) {
      setScrollOffset(ptyId, yToScrollOffset(ptyId, relY));
      return;
    }

    if (!getPreviewMode()) return;

    // Try selection drag first
    const handled = mouseHandler.handleSelectionMouseDrag(
      ptyId,
      relX,
      relY,
      getPreviewInnerHeight()
    );
    if (handled) return;

    // Don't forward if app doesn't want mouse input
    if (!mouseHandler.appWantsMouse(ptyId)) return;

    // Don't forward drag when scrolled back - we're in "history viewing" mode
    if (isScrolledBack(ptyId)) return;

    if (!isInsideContent(relX, relY)) return;
    forwardMouseEvent(ptyId, event, 'drag', relX, relY);
  };

  const handlePreviewMouseScroll = (event: OpenTUIMouseEvent) => {
    const ptyId = getSelectedPtyId();
    if (!ptyId) return;

    const { relX, relY } = getRelativeCoords(event);
    if (!isInsideContent(relX, relY)) return;

    const direction = event.scroll?.direction;
    if (!direction) return;

    const inPreviewMode = getPreviewMode();

    // Only forward scroll to the app when preview is actively selected.
    if (inPreviewMode && mouseHandler.appWantsMouse(ptyId)) {
      const button = scrollDirectionToButton(direction);
      const sequence = inputHandler.encodeMouse({
        type: 'scroll',
        button,
        x: relX,
        y: relY,
        shift: event.modifiers?.shift,
        alt: event.modifiers?.alt,
        ctrl: event.modifiers?.ctrl,
      });
      writeToPty(ptyId, sequence);
      return;
    }

    // Handle scroll locally (works even when preview isn't active).
    // 1 line per event — the ScrollAnimator in TerminalContext smooths
    // rapid events into a chase animation.
    const scrollSpeed = 1;
    if (direction === 'up') {
      scrollTerminal(ptyId, scrollSpeed);
    } else if (direction === 'down') {
      scrollTerminal(ptyId, -scrollSpeed);
    }
  };

  return {
    handlePreviewMouseDown,
    handlePreviewMouseUp,
    handlePreviewMouseMove,
    handlePreviewMouseDrag,
    handlePreviewMouseScroll,
    cleanup: mouseHandler.cleanup,
  };
}
