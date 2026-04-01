/**
 * ListPane - Left-side session/PTY list component for AggregateView.
 *
 * Displays a scrollable, hierarchical tree of sessions and their PTYs.
 * Supports selection, expansion, drag-and-drop reordering, and lazy loading.
 */

import { Show, For, type Component, type JSX } from 'solid-js';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { FlattenedTreeItem, TreeNode } from '../../contexts/aggregate-view-types';
import type { Theme } from '../../contexts/ThemeContext';
import type { SessionTreeNodeProps } from './SessionTreeNode';
import type { PtyTreeRowProps } from './PtyTreeRow';
import type { PlaceholderRowProps } from './PlaceholderRow';

/** Layout dimensions for the list pane */
interface ListLayout {
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
}

/** Viewport state for scrolling indicators */
interface ListViewport {
  start: number;
  end: number;
  visibleCount: number;
  showTopIndicator: boolean;
  showBottomIndicator: boolean;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
}

/** Props for the ListPane component */
interface ListPaneProps {
  /** Theme for styling */
  theme: Theme;
  /** Foreground color */
  foregroundColor: string;
  /** Muted color for secondary text */
  mutedColor: string;
  /** Subtle color for tertiary text */
  subtleColor: string;
  /** Layout dimensions */
  layout: ListLayout;
  /** Viewport state */
  viewport: ListViewport;
  /** All flattened tree items */
  flattenedTree: FlattenedTreeItem[];
  /** Currently selected index */
  selectedIndex: number;
  /** Currently active session ID */
  activeSessionId: string | null;
  /** Session ID being dragged (for visual feedback) */
  draggingSessionId: string | null;
  /** Session ID that is current drag target */
  dragTargetSessionId: string | null;
  /** Whether in preview mode (affects border highlighting) */
  isPreviewMode: boolean;
  /** Callback when an item is selected */
  onSelectItem: (index: number) => void;
  /** Callback when a PTY is selected */
  onSelectPty: (ptyId: string) => void;
  /** Callback when a session expansion is toggled */
  onToggleSession: (sessionId: string) => void;
  /** Callback when a session drag starts */
  onBeginSessionDrag: (sessionId: string) => void;
  /** Callback when session drag ends (for click vs drag detection) */
  onEndSessionDrag: (sessionId: string, didDrag: boolean) => void;
  /** Callback when a placeholder is clicked (for lazy loading) */
  onPlaceholderClick: (sessionId: string) => void;
  /** Callback to get item at mouse position */
  getItemAtMouse: (event: OpenTUIMouseEvent) => FlattenedTreeItem | undefined;
  /** Callback to update drag target during drag */
  onUpdateDragTarget: (event: OpenTUIMouseEvent) => void;
  /** Callback when drag operation completes */
  onCommitDrag: () => void;
  /** Callback to scroll list up */
  onScrollUp: (amount: number) => void;
  /** Callback to scroll list down */
  onScrollDown: (amount: number) => void;
  /** Callback when list pane is clicked (to exit preview mode) */
  onExitPreview: () => void;
  /** Host background color for shimmer effects */
  shimmerTargetColor: string;
  /** Component renderers (injected for tree-shaking and testing) */
  components: {
    SessionTreeNode: Component<SessionTreeNodeProps>;
    PtyTreeRow: Component<PtyTreeRowProps>;
    PlaceholderRow: Component<PlaceholderRowProps>;
  };
}

/**
 * ListPane component - Displays the session/PTY tree list.
 */
export const ListPane: Component<ListPaneProps> = (props) => {
  // Get visible items based on viewport
  const visibleItems = () => {
    return props.flattenedTree.slice(props.viewport.start, props.viewport.end);
  };

  // Handle mouse down on session (starts drag)
  const handleSessionMouseDown = (sessionId: string, index: number) => {
    props.onSelectItem(index);
    props.onBeginSessionDrag(sessionId);
  };

  // Handle mouse up on session (toggle or end drag)
  const handleSessionMouseUp = (sessionId: string, loadState: { status: string }) => {
    // Only toggle if not dragging and session is loaded
    // The didDrag check is handled by the parent via suppressSessionToggle
    if (loadState.status === 'loaded') {
      props.onToggleSession(sessionId);
    }
  };

  // Tree prefix helpers
  const sessionIndent = () => '';
  const ptyIndent = () => '    ';
  const ptyTreePrefix = () => '•';

  return (
    <box
      style={{
        width: props.layout.width,
        height: props.layout.height,
        border: true,
        borderStyle: 'single',
        borderColor: props.isPreviewMode
          ? props.theme.pane.borderColor
          : props.theme.pane.focusedBorderColor,
      }}
      onMouseDown={(e: { preventDefault: () => void }) => {
        e.preventDefault();
        props.onExitPreview();
      }}
      onMouseDrag={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        props.onUpdateDragTarget(e);
      }}
      onMouseUp={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        props.onCommitDrag();
      }}
      onMouseScroll={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        const direction = e.scroll?.direction;
        if (!direction) return;
        if (direction === 'up') {
          props.onScrollUp(3);
        } else if (direction === 'down') {
          props.onScrollDown(3);
        }
      }}
    >
      <box style={{ flexDirection: 'column' }}>
        {/* Scroll up indicator */}
        <Show when={props.viewport.showTopIndicator}>
          <box style={{ height: 1, justifyContent: 'center' }}>
            <text fg={props.subtleColor}>▲ {props.viewport.hiddenAboveCount} more</text>
          </box>
        </Show>

        {/* Empty state */}
        <Show
          when={props.flattenedTree.length > 0}
          fallback={
            <box
              style={{
                height: props.layout.innerHeight,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <text fg={props.subtleColor}>No sessions match filter</text>
            </box>
          }
        >
          {/* Tree items */}
          <For each={visibleItems()}>
            {(item) => {
              const node = () => item.node;
              const isSelected = () => item.index === props.selectedIndex;
              const textColors = {
                foreground: props.foregroundColor,
                muted: props.mutedColor,
                subtle: props.subtleColor,
              };

              // Spacer rows
              if (node().type === 'spacer') {
                return <box style={{ height: 1 }} />;
              }

              return (
                <Show
                  when={node().type === 'session'}
                  fallback={
                    <Show
                      when={node().type === 'pty'}
                      fallback={
                        // Placeholder row
                        <props.components.PlaceholderRow
                          treePrefix=""
                          indent={ptyIndent()}
                          maxWidth={props.layout.innerWidth}
                          aggregateTheme={props.theme.ui.aggregate}
                          textColors={textColors}
                          isSelected={isSelected()}
                          label={(node() as Extract<TreeNode, { type: 'placeholder' }>).message}
                          onClick={() => {
                            props.onSelectItem(item.index);
                            const placeholderNode = node() as Extract<
                              TreeNode,
                              { type: 'placeholder' }
                            >;
                            const sessionId = placeholderNode.parentSessionId;
                            if (sessionId) {
                              props.onPlaceholderClick(sessionId);
                            }
                          }}
                        />
                      }
                    >
                      {/* PTY row */}
                      <props.components.PtyTreeRow
                        pty={(node() as Extract<TreeNode, { type: 'pty' }>).ptyInfo}
                        isSelected={isSelected()}
                        maxWidth={props.layout.innerWidth}
                        treePrefix={ptyTreePrefix()}
                        indent={ptyIndent()}
                        aggregateTheme={props.theme.ui.aggregate}
                        shimmerTargetColor={props.shimmerTargetColor}
                        textColors={textColors}
                        onClick={() => {
                          const ptyNode = node() as Extract<TreeNode, { type: 'pty' }>;
                          props.onSelectPty(ptyNode.ptyInfo.ptyId);
                          if (props.isPreviewMode) {
                            props.onExitPreview();
                          }
                        }}
                      />
                    </Show>
                  }
                >
                  {/* Session row */}
                  <props.components.SessionTreeNode
                    sessionName={(node() as Extract<TreeNode, { type: 'session' }>).session.name}
                    paneCount={(node() as Extract<TreeNode, { type: 'session' }>).ptyCount}
                    treePrefix=""
                    indent={sessionIndent()}
                    isSelected={isSelected()}
                    isExpanded={(node() as Extract<TreeNode, { type: 'session' }>).isExpanded}
                    isActive={
                      (node() as Extract<TreeNode, { type: 'session' }>).session.id ===
                      props.activeSessionId
                    }
                    isDropTarget={
                      props.dragTargetSessionId ===
                        (node() as Extract<TreeNode, { type: 'session' }>).session.id &&
                      props.draggingSessionId !== null
                    }
                    isDragging={
                      props.draggingSessionId ===
                      (node() as Extract<TreeNode, { type: 'session' }>).session.id
                    }
                    maxWidth={props.layout.innerWidth}
                    aggregateTheme={props.theme.ui.aggregate}
                    textColors={textColors}
                    onMouseDown={() => {
                      const sessionNode = node() as Extract<TreeNode, { type: 'session' }>;
                      handleSessionMouseDown(sessionNode.session.id, item.index);
                    }}
                    onMouseUp={() => {
                      const sessionNode = node() as Extract<TreeNode, { type: 'session' }>;
                      handleSessionMouseUp(sessionNode.session.id, sessionNode.loadState);
                    }}
                  />
                </Show>
              );
            }}
          </For>
        </Show>

        {/* Scroll down indicator */}
        <Show when={props.viewport.showBottomIndicator}>
          <box style={{ height: 1, justifyContent: 'center' }}>
            <text fg={props.subtleColor}>▼ {props.viewport.hiddenBelowCount} more</text>
          </box>
        </Show>
      </box>
    </box>
  );
};

export type { ListPaneProps, ListLayout, ListViewport };
