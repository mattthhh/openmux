/**
 * ListPane - Left-side session/PTY list component for AggregateView.
 *
 * Displays a scrollable, hierarchical tree of sessions and their PTYs.
 * Mouse interaction is preserved (click to select/expand/scroll) but
 * the list pane always appears visually unfocused (dim border) — the
 * preview pane is the only "focused" area in aggregate view.
 *
 * NOTE: Uses ListPaneContext for theme, layout, viewport, and handlers.
 * Props reduced from 26 to 4: components, SessionTreeNode, PtyTreeRow, PlaceholderRow.
 */

import { Show, For, createMemo, type Component } from 'solid-js';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { TreeNode } from '../../contexts/aggregate-view-types';
import { useListPane, useListPaneColors } from '../../contexts/ListPaneContext';
import type { SessionTreeNodeProps } from './SessionTreeNode';
import type { PtyTreeRowProps } from './PtyTreeRow';
import type { PlaceholderRowProps } from './PlaceholderRow';

/** Props for the ListPane component - reduced to essentials */
export interface ListPaneProps {
  /** Component renderers (injected for tree-shaking and testing) */
  components: {
    SessionTreeNode: Component<SessionTreeNodeProps>;
    PtyTreeRow: Component<PtyTreeRowProps>;
    PlaceholderRow: Component<PlaceholderRowProps>;
  };
}

/**
 * ListPane component - Displays the session/PTY tree list.
 * Uses ListPaneContext for all state, layout, colors, and handlers.
 */
export const ListPane: Component<ListPaneProps> = (props) => {
  const ctx = useListPane();
  const colors = useListPaneColors();

  // Memoize visible items to prevent recreating array on every render
  const visibleItems = createMemo(() => {
    return ctx.state.flattenedTree.slice(ctx.viewport.start, ctx.viewport.end);
  });

  // Handle mouse down on session (starts drag)
  const handleSessionMouseDown = (sessionId: string, index: number) => {
    ctx.selectionHandlers.onSelectItem(index);
    ctx.dragHandlers.onBeginSessionDrag(sessionId);
  };

  // Handle mouse up on session (toggle or end drag)
  const handleSessionMouseUp = (sessionId: string, loadState: { status: string }) => {
    if (loadState.status === 'loaded') {
      ctx.selectionHandlers.onToggleSession(sessionId);
    }
  };

  // Tree prefix helpers
  const ptyIndent = () => '    ';

  return (
    <box
      style={{
        width: ctx.layout.width,
        height: ctx.layout.height,
        border: true,
        borderStyle: 'single',
        // Always use the unfocused (dim) border color — the preview pane
        // is the only "focused" pane in aggregate view.
        borderColor: colors.theme.pane.borderColor,
      }}
      backgroundColor="transparent"
      onMouseDrag={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        ctx.dragHandlers.onUpdateDragTarget(e);
      }}
      onMouseUp={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        ctx.dragHandlers.onCommitDrag();
      }}
      onMouseScroll={(e: OpenTUIMouseEvent) => {
        e.preventDefault();
        const direction = e.scroll?.direction;
        if (!direction) return;
        if (direction === 'up') {
          ctx.scrollHandlers.onScrollUp(3);
        } else if (direction === 'down') {
          ctx.scrollHandlers.onScrollDown(3);
        }
      }}
    >
      <box style={{ flexDirection: 'column' }} backgroundColor="transparent">
        {/* Scroll up indicator */}
        <Show when={ctx.viewport.showTopIndicator}>
          <box style={{ height: 1, justifyContent: 'center' }}>
            <text fg={colors.subtleColor()}>▲ {ctx.viewport.hiddenAboveCount} more</text>
          </box>
        </Show>

        {/* Empty state */}
        <Show
          when={ctx.state.flattenedTree.length > 0}
          fallback={
            <box
              style={{
                height: ctx.layout.innerHeight,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <text fg={colors.subtleColor()}>No sessions match filter</text>
            </box>
          }
        >
          {/* Tree items */}
          <For each={visibleItems()}>
            {(item) => {
              const node = () => item.node;
              const isSelected = () => item.index === ctx.state.selectedIndex;
              const textColors = {
                foreground: colors.foregroundColor(),
                muted: colors.mutedColor(),
                subtle: colors.subtleColor(),
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
                        <props.components.PlaceholderRow
                          indent={ptyIndent()}
                          maxWidth={ctx.layout.innerWidth}
                          aggregateTheme={colors.theme.ui.aggregate}
                          textColors={textColors}
                          isSelected={isSelected()}
                          label={(node() as Extract<TreeNode, { type: 'placeholder' }>).message}
                          onClick={() => {
                            ctx.selectionHandlers.onSelectItem(item.index);
                          }}
                        />
                      }
                    >
                      {/* PTY row — click selects the PTY for preview */}
                      <props.components.PtyTreeRow
                        pty={(node() as Extract<TreeNode, { type: 'pty' }>).ptyInfo}
                        isSelected={isSelected()}
                        focusedPtyId={ctx.focusedPtyId}
                        maxWidth={ctx.layout.innerWidth}
                        indent={ptyIndent()}
                        aggregateTheme={colors.theme.ui.aggregate}
                        shimmerTargetColor={ctx.shimmerTargetColor}
                        textColors={textColors}
                        onClick={() => {
                          const ptyNode = node() as Extract<TreeNode, { type: 'pty' }>;
                          ctx.selectionHandlers.onSelectPty(ptyNode.ptyInfo.ptyId);
                        }}
                      />
                    </Show>
                  }
                >
                  {/* Session row — click toggles expand/collapse */}
                  <props.components.SessionTreeNode
                    sessionName={(node() as Extract<TreeNode, { type: 'session' }>).session.name}
                    paneCount={(node() as Extract<TreeNode, { type: 'session' }>).ptyCount}
                    isSelected={isSelected()}
                    isExpanded={(node() as Extract<TreeNode, { type: 'session' }>).isExpanded}
                    isActive={
                      (node() as Extract<TreeNode, { type: 'session' }>).session.id ===
                      ctx.state.activeSessionId
                    }
                    isDropTarget={
                      ctx.state.dragTargetSessionId ===
                        (node() as Extract<TreeNode, { type: 'session' }>).session.id &&
                      ctx.state.draggingSessionId !== null
                    }
                    isDragging={
                      ctx.state.draggingSessionId ===
                      (node() as Extract<TreeNode, { type: 'session' }>).session.id
                    }
                    maxWidth={ctx.layout.innerWidth}
                    aggregateTheme={colors.theme.ui.aggregate}
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
        <Show when={ctx.viewport.showBottomIndicator}>
          <box style={{ height: 1, justifyContent: 'center' }}>
            <text fg={colors.subtleColor()}>▼ {ctx.viewport.hiddenBelowCount} more</text>
          </box>
        </Show>
      </box>
    </box>
  );
};
