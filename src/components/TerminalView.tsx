/**
 * TerminalView - renders terminal state using direct buffer access for performance
 * Uses Effect bridge for PTY operations.
 */

import { createSignal, createEffect, on, Show } from 'solid-js';
import { useRenderer } from '@opentui/solid';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import { useTerminal } from '../contexts/TerminalContext';
import { useSelection } from '../contexts/SelectionContext';
import { useCopyMode } from '../contexts/copy-mode';
import { useSearch } from '../contexts/SearchContext';
import { useTheme } from '../contexts/ThemeContext';
import { deferMacrotask } from '../core/scheduling';
import { createTerminalRenderer } from './terminal-view/terminal-renderer';
import { createTerminalViewState } from './terminal-view/view-state';
import { setupUnifiedSubscription } from './terminal-view/unified-subscription';
import type { TerminalViewProps } from './terminal-view/types';

let nextKittyPaneId = 0;

/**
 * TerminalView component - uses direct buffer rendering for maximum performance
 */
export function TerminalView(props: TerminalViewProps) {
  const renderer = useRenderer();
  const terminal = useTerminal();
  const theme = useTheme();
  const kittyPaneKey = `kitty-pane-${nextKittyPaneId++}`;
  // Get selection state - keep full context to access selectionVersion reactively
  const selection = useSelection();
  const { isCellSelected, getSelection } = selection;
  const copyMode = useCopyMode();
  // Get search state - keep full context to access searchVersion reactively
  const search = useSearch();
  const { isSearchMatch, isCurrentMatch } = search;

  const viewState = createTerminalViewState();
  const recentPrefetchWindow = 32;

  // Version counter to trigger re-renders when state changes
  const [version, setVersion] = createSignal(0);

  setupUnifiedSubscription({
    getPtyId: () => props.ptyId,
    terminal,
    renderer,
    viewState,
    setVersion,
    kittyPaneKey,
    recentPrefetchWindow,
    isFocused: () => props.isFocused,
  });

  const renderTerminal = createTerminalRenderer({
    props,
    viewState,
    selection: {
      isCellSelected,
      getSelection,
    },
    copyMode: {
      isActive: copyMode.isActive,
      getCursor: copyMode.getCursor,
      isCellSelected: copyMode.isCellSelected,
      hasSelection: copyMode.hasSelection,
    },
    search: {
      isSearchMatch,
      isCurrentMatch,
      getSearchState: () => search.searchState,
    },
    theme,
    kittyPaneKey,
  });

  // Request render when selection or search version changes.
  // Only re-render this pane if the selection/search actually affects it,
  // avoiding cross-pane renders during mouse drag (regression from modularization).
  let lastSelectionRef: unknown = null;
  let lastSearchRef: unknown = null;
  let lastSearchPtyId: string | null = null;

  createEffect(
    on(
      [
        () => selection.selectionVersion,
        () => search.searchVersion,
        () => copyMode.copyModeVersion,
      ],
      () => {
        const selectionRef = getSelection(props.ptyId) ?? null;
        const searchState = search.searchState;
        const searchPtyId = searchState?.ptyId ?? null;
        const affectsSearch = searchPtyId === props.ptyId || lastSearchPtyId === props.ptyId;

        const selectionChanged = selectionRef !== lastSelectionRef;
        const searchChanged = affectsSearch && searchState !== lastSearchRef;
        const copyModeChanged =
          copyMode.isActive(props.ptyId) || copyMode.hasSelection(props.ptyId);

        if (selectionChanged || searchChanged || copyModeChanged) {
          renderer.requestRender();
        }

        lastSelectionRef = selectionRef;
        if (affectsSearch) {
          lastSearchRef = searchState;
        }
        lastSearchPtyId = searchPtyId;
      }
    )
  );

  createEffect(
    on(
      () => terminal.hostColorsVersion,
      () => {
        setVersion((v) => v + 1);
        renderer.requestRender();
      }
    )
  );

  // Resize events don't always trigger a terminal update, so force a render to avoid blank frames.
  // Defer to macrotask to ensure any pending emulator resize updates arrive before we render,
  // preventing a race where we render with stale dimensions before the reflowed state arrives.
  createEffect(
    on([() => props.width, () => props.height], () => {
      deferMacrotask(() => {
        setVersion((v) => v + 1);
        renderer.requestRender();
      });
    })
  );

  // Scrollbar click handling: during heavy stdout rendering, OpenTUI routes
  // mouse events to this inner box (the hit-test target) instead of the parent
  // Pane's box. We handle the scrollbar click here so it always works regardless
  // of which box OpenTUI delivers the event to.
  //
  // Key: use viewState.scrollState (the same source the renderer uses) instead of
  // terminal.getScrollState() (which reads from ptyCaches). During heavy output
  // with active animation, the cache's viewportOffset can lag behind viewState's
  // because the subscriber's single-writer rule skips the absolute value write
  // when animating or scroll-locked. viewState is always in sync with the
  // rendered scrollbar position.
  const handleMouseDown = (event: OpenTUIMouseEvent) => {
    const ptyId = props.ptyId;
    if (!ptyId) return;
    const scrollState = viewState.scrollState;
    if (!scrollState || scrollState.viewportOffset === 0) return;
    // offsetX/Y already accounts for the Pane's left/top border (+1).
    // relX/Y should be in content-area coordinates (0 = first content col/row).
    const relX = event.x - (props.offsetX ?? 0);
    const relY = event.y - (props.offsetY ?? 0);
    if (relX !== props.width - 1) return;
    if (relY < 0 || relY >= props.height) return;
    event.preventDefault();
    // Don't stopPropagation — let the event bubble to Pane so its
    // scrollbarDrag.isDragging flag and drag/up handlers still work.
    const ratio = 1 - relY / Math.max(1, props.height - 1);
    const offset = Math.round(ratio * scrollState.scrollbackLength);
    terminal.setScrollOffset(ptyId, offset);
  };

  return (
    <Show
      when={version() > 0}
      fallback={
        <box
          style={{
            width: props.width,
            height: props.height,
          }}
          backgroundColor="transparent"
          onMouseDown={handleMouseDown}
        />
      }
    >
      <box
        style={{
          width: props.width,
          height: props.height,
        }}
        backgroundColor="transparent"
        onMouseDown={handleMouseDown}
        renderAfter={renderTerminal}
      />
    </Show>
  );
}
