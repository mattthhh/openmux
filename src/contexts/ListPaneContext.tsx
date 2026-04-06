/**
 * ListPaneContext - Consolidated context for ListPane to eliminate prop drilling.
 *
 * This context provides:
 * - Theme/colors (derived internally from useTheme and useOverlayColors)
 * - Layout and viewport state
 * - Consolidated handler objects (selection, drag, scroll)
 * - State references (selectedIndex, activeSessionId, etc.)
 */

import { createContext, useContext, type ParentProps } from 'solid-js';
import { useTheme } from './ThemeContext';
import { useOverlayColors } from '../components/overlay-colors';
import type { FlattenedTreeItem } from './aggregate-view-types';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';

/** Layout dimensions for the list pane */
export interface ListLayout {
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
}

/** Viewport state for scrolling indicators */
export interface ListViewport {
  start: number;
  end: number;
  visibleCount: number;
  showTopIndicator: boolean;
  showBottomIndicator: boolean;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
}

/** Consolidated selection handlers */
export interface ListSelectionHandlers {
  /** Select an item by index */
  onSelectItem: (index: number) => void;
  /** Select a PTY by ID */
  onSelectPty: (ptyId: string) => void;
  /** Toggle session expansion */
  onToggleSession: (sessionId: string) => void;
}

/** Consolidated drag handlers */
export interface ListDragHandlers {
  /** Start dragging a session */
  onBeginSessionDrag: (sessionId: string) => void;
  /** End session drag (with drag detection flag) */
  onEndSessionDrag: (sessionId: string, didDrag: boolean) => void;
  /** Update drag target during drag */
  onUpdateDragTarget: (event: OpenTUIMouseEvent) => void;
  /** Commit the drag operation */
  onCommitDrag: () => void;
  /** Get item at mouse position for hit testing */
  getItemAtMouse: (event: OpenTUIMouseEvent) => FlattenedTreeItem | undefined;
}

/** Consolidated scroll/exit handlers */
export interface ListScrollHandlers {
  /** Scroll list up */
  onScrollUp: (amount: number) => void;
  /** Scroll list down */
  onScrollDown: (amount: number) => void;
  /** Exit preview mode (list pane clicked) */
  onExitPreview: () => void;
  /** Clicked on placeholder (lazy loading) */
  onPlaceholderClick: (sessionId: string) => void;
}

/** State values for ListPane */
export interface ListPaneState {
  /** All flattened tree items */
  flattenedTree: FlattenedTreeItem[];
  /** Currently selected index */
  selectedIndex: number;
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Session ID being dragged */
  draggingSessionId: string | null;
  /** Session ID that is current drag target */
  dragTargetSessionId: string | null;
  /** Whether in preview mode */
  isPreviewMode: boolean;
}

/** Props passed to ListPane (now minimal) */
export interface ListPaneContextValue {
  /** Layout dimensions */
  layout: ListLayout;
  /** Viewport state */
  viewport: ListViewport;
  /** Tree state */
  state: ListPaneState;
  /** Selection handlers */
  selectionHandlers: ListSelectionHandlers;
  /** Drag handlers */
  dragHandlers: ListDragHandlers;
  /** Scroll handlers */
  scrollHandlers: ListScrollHandlers;
  /** Shimmer target color (host bg for effects) */
  shimmerTargetColor: string;
}

const ListPaneContext = createContext<ListPaneContextValue | null>(null);

export interface ListPaneProviderProps extends ParentProps {
  /** Layout dimensions */
  layout: ListLayout;
  /** Viewport state */
  viewport: ListViewport;
  /** Tree state */
  state: ListPaneState;
  /** Selection handlers */
  selectionHandlers: ListSelectionHandlers;
  /** Drag handlers */
  dragHandlers: ListDragHandlers;
  /** Scroll handlers */
  scrollHandlers: ListScrollHandlers;
  /** Shimmer target color */
  shimmerTargetColor: string;
}

export function createListPaneContextValue(props: ListPaneProviderProps): ListPaneContextValue {
  return {
    get layout() {
      return props.layout;
    },
    get viewport() {
      return props.viewport;
    },
    get state() {
      return props.state;
    },
    get selectionHandlers() {
      return props.selectionHandlers;
    },
    get dragHandlers() {
      return props.dragHandlers;
    },
    get scrollHandlers() {
      return props.scrollHandlers;
    },
    get shimmerTargetColor() {
      return props.shimmerTargetColor;
    },
  };
}

export function ListPaneProvider(props: ListPaneProviderProps) {
  return (
    <ListPaneContext.Provider value={createListPaneContextValue(props)}>
      {props.children}
    </ListPaneContext.Provider>
  );
}

export function useListPane(): ListPaneContextValue {
  const context = useContext(ListPaneContext);
  if (!context) {
    throw new Error('useListPane must be used within ListPaneProvider');
  }
  return context;
}

/** Hook for ListPane to get theme/colors internally */
export function useListPaneColors() {
  const theme = useTheme();
  const overlayColors = useOverlayColors();

  return {
    theme,
    foregroundColor: overlayColors.foreground,
    mutedColor: overlayColors.muted,
    subtleColor: overlayColors.subtle,
  };
}
