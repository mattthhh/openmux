import type { OptimizedBuffer } from '@opentui/core';
import { isAtBottom as checkIsAtBottom } from '../../core/scroll-utils';
import { BLACK, getCachedRGBA, SELECTION_BG } from '../../terminal/rendering';
import { getKittyGraphicsRenderer } from '../../terminal/kitty-graphics';
import type { SelectionRange } from '../../core/coordinates';
import type { SearchMatch } from '../../contexts/search/types';
import {
  renderRowDirect,
  renderScrollbar,
  renderScrollDepth,
  fetchRowsForRendering,
  calculatePrefetchRequest,
  guardScrollbackRender,
  DEFAULT_BG_SENTINEL,
} from './index';
import { resolveThemeColor } from './theme-color';
import type { TerminalViewProps } from './types';
import type { TerminalViewState } from './view-state';
import { flushPtyData } from '../../effect/bridge';

interface SelectionDeps {
  isCellSelected: (ptyId: string, row: number, col: number) => boolean;
  getSelection: (ptyId: string) => { normalizedRange: SelectionRange | null } | undefined;
}

interface SearchDeps {
  isSearchMatch: (ptyId: string, row: number, col: number) => boolean;
  isCurrentMatch: (ptyId: string, row: number, col: number) => boolean;
  getSearchState: () => { ptyId: string; matches: SearchMatch[] } | null | undefined;
}

interface CopyModeDeps {
  isActive: (ptyId?: string) => boolean;
  getCursor: (ptyId: string) => { x: number; absY: number } | null;
  isCellSelected: (ptyId: string, row: number, col: number) => boolean;
  hasSelection: (ptyId: string) => boolean;
}

interface ThemeDeps {
  pane: {
    focusedBorderColor: string;
    borderColor: string;
    copyModeBorderColor: string;
  };
  ui: {
    mutedText: string;
    copyMode: {
      selection: { foreground: string; background: string };
      cursor: { foreground: string; background: string };
    };
  };
}

export function createTerminalRenderer(params: {
  props: TerminalViewProps;
  viewState: TerminalViewState;
  selection: SelectionDeps;
  copyMode: CopyModeDeps;
  search: SearchDeps;
  theme: ThemeDeps;
  kittyPaneKey: string;
}) {
  const { props, viewState, selection, copyMode, search, theme, kittyPaneKey } = params;

  let _perfCount = 0;
  let _perfAccum = 0;
  let _perfLastLog = 0;
  return (buffer: OptimizedBuffer) => {
    const _perfT0 = performance.now();

    // Flush any pending PTY data + emulator updates synchronously before rendering.
    // This eliminates the setImmediate scheduling latency (~0-4ms per hop) in the
    // data pipeline: handleData → setImmediate(drainPending) → emulator.write() →
    // setImmediate(flushDeferredNotify). By flushing both the PTY data drain and
    // the emulator notification in the render callback, we collapse 2-3 async
    // hops into 0, saving 4-12ms per frame for animated content.
    //
    // Without this, the render callback sees stale cell state because the
    // deferred notifications haven't fired yet. The deferred paths still run
    // as fallbacks (they'll be no-ops since the state is already flushed).
    const ptyId = props.ptyId;
    if (ptyId) {
      flushPtyData(ptyId);
    }
    const em = viewState.emulator;
    if (em?.flushPendingNotify) {
      em.flushPendingNotify();
    }

    const state = viewState.terminalState;
    const width = props.width;
    const height = props.height;
    const offsetX = props.offsetX ?? 0;
    const offsetY = props.offsetY ?? 0;
    const isFocused = props.isFocused;
    const emulator = viewState.emulator;
    const kittyRenderer = getKittyGraphicsRenderer();

    if (!state) {
      // Fill with sentinel (transparent) so the host background shows through
      // even when there is no terminal state yet.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, DEFAULT_BG_SENTINEL, 0);
        }
      }
      kittyRenderer?.removePane(kittyPaneKey);
      return;
    }

    const desiredViewportOffset = viewState.scrollState.viewportOffset;
    const desiredScrollbackLength = viewState.scrollState.scrollbackLength;

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    // Use the sentinel (transparent/default-bg) for padding cells so that
    // areas without terminal content let the host's background show through.
    // Real cell colors are applied per-cell by getCellColors().
    const fallbackBg = DEFAULT_BG_SENTINEL;
    const fallbackFg = BLACK;

    const {
      rowCache: desiredRowCache,
      firstMissingOffset,
      lastMissingOffset,
    } = fetchRowsForRendering(
      state,
      emulator,
      {
        viewportOffset: desiredViewportOffset,
        scrollbackLength: desiredScrollbackLength,
        rows,
      },
      viewState.pooledRowCache
    );

    if (viewState.lastStableScrollbackLength === 0 && desiredScrollbackLength > 0) {
      viewState.lastStableScrollbackLength = desiredScrollbackLength;
      viewState.lastStableViewportOffset = desiredViewportOffset;
    }

    const guard = guardScrollbackRender({
      desiredViewportOffset,
      desiredScrollbackLength,
      rows,
      desiredRowCache,
      lastStableViewportOffset: viewState.lastStableViewportOffset,
      lastStableScrollbackLength: viewState.lastStableScrollbackLength,
      lastObservedViewportOffset: viewState.lastObservedViewportOffset,
      lastObservedScrollbackLength: viewState.lastObservedScrollbackLength,
    });

    const prefetchRequest = calculatePrefetchRequest(
      ptyId,
      firstMissingOffset,
      lastMissingOffset,
      desiredScrollbackLength,
      rows
    );
    const supportsPrefetch =
      !!emulator &&
      typeof (emulator as { prefetchScrollbackLines?: unknown }).prefetchScrollbackLines ===
        'function';
    const shouldPrefetch = guard.isUserScroll || desiredViewportOffset > 0;
    if (
      prefetchRequest &&
      supportsPrefetch &&
      !viewState.prefetchInProgress &&
      viewState.executePrefetchFn &&
      shouldPrefetch
    ) {
      viewState.pendingPrefetch = prefetchRequest;
      queueMicrotask(viewState.executePrefetchFn);
    }
    viewState.lastObservedViewportOffset = desiredViewportOffset;
    viewState.lastObservedScrollbackLength = desiredScrollbackLength;

    let renderViewportOffset = guard.renderViewportOffset;
    let renderScrollbackLength = guard.renderScrollbackLength;
    let rowCache = guard.renderRowCache;

    if (guard.shouldDefer) {
      renderViewportOffset = Math.min(viewState.lastStableViewportOffset, desiredScrollbackLength);
      renderScrollbackLength = Math.min(
        viewState.lastStableScrollbackLength,
        desiredScrollbackLength
      );
      if (viewState.lastStableRowCache) {
        rowCache = viewState.lastStableRowCache;
      } else {
        const renderFetch = fetchRowsForRendering(state, emulator, {
          viewportOffset: renderViewportOffset,
          scrollbackLength: renderScrollbackLength,
          rows,
        });
        rowCache = renderFetch.rowCache;
      }
    } else {
      viewState.lastStableViewportOffset = desiredViewportOffset;
      viewState.lastStableScrollbackLength = desiredScrollbackLength;
      viewState.lastStableRowCache = guard.renderRowCache.slice();
      rowCache = guard.renderRowCache;
    }

    const isAtBottom = checkIsAtBottom(renderViewportOffset);

    const hasSelection = !!selection.getSelection(ptyId)?.normalizedRange;
    const copyModeActive = copyMode.isActive(ptyId);
    const copyCursor = copyModeActive ? copyMode.getCursor(ptyId) : null;
    const hasCopySelection = copyModeActive && copyMode.hasSelection(ptyId);
    const currentSearchState = search.getSearchState();
    const hasSearch = currentSearchState?.ptyId === ptyId && currentSearchState.matches.length > 0;

    const copySelectionFg = resolveThemeColor(
      theme.ui.copyMode.selection.foreground,
      getCachedRGBA(245, 243, 255)
    );
    const copySelectionBg = resolveThemeColor(
      theme.ui.copyMode.selection.background,
      getCachedRGBA(124, 58, 237)
    );
    const copyCursorFg = resolveThemeColor(
      theme.ui.copyMode.cursor.foreground,
      getCachedRGBA(31, 41, 55)
    );
    const copyCursorBg = resolveThemeColor(
      theme.ui.copyMode.cursor.background,
      getCachedRGBA(196, 181, 253)
    );

    // Capture search snapshot once per frame to avoid per-cell signal reads.
    const searchSnapshot = hasSearch
      ? {
          isMatch: (x: number, absoluteY: number) => search.isSearchMatch(ptyId, x, absoluteY),
          isCurrent: (x: number, absoluteY: number) => search.isCurrentMatch(ptyId, x, absoluteY),
        }
      : null;

    const renderOptions = {
      ptyId,
      hasSelection,
      hasSearch,
      hasCopySelection,
      copyModeActive,
      isAtBottom,
      isFocused,
      cursorX: state.cursor.x,
      cursorY: state.cursor.y,
      cursorVisible: state.cursor.visible,
      copyCursor,
      scrollbackLength: renderScrollbackLength,
      viewportOffset: renderViewportOffset,
      copySelectionFg,
      copySelectionBg,
      copyCursorFg,
      copyCursorBg,
      searchSnapshot,
    };

    const renderDeps = {
      isCellSelected: selection.isCellSelected,
      isCopySelected: copyMode.isCellSelected,
      isSearchMatch: search.isSearchMatch,
      isCurrentMatch: search.isCurrentMatch,
      getSelection: selection.getSelection,
    };

    for (let y = 0; y < rows; y++) {
      const row = rowCache[y];
      renderRowDirect(
        buffer,
        row,
        y,
        cols,
        offsetX,
        offsetY,
        renderOptions,
        renderDeps,
        fallbackFg,
        fallbackBg
      );
    }

    if (cols < width || rows < height) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < rows && x < cols) continue;
          buffer.setCell(x + offsetX, y + offsetY, ' ', fallbackFg, fallbackBg, 0);
        }
      }
    }

    if (!isAtBottom) {
      renderScrollbar(
        buffer,
        rowCache,
        {
          viewportOffset: renderViewportOffset,
          scrollbackLength: renderScrollbackLength,
          rows,
          cols,
          width,
          offsetX,
          offsetY,
          ptyId,
          hasSelection,
          hasCopySelection,
          isCellSelected: selection.isCellSelected,
          isCopySelected: copyMode.isCellSelected,
          selectionBg: SELECTION_BG,
          copySelectionBg,
        },
        fallbackFg
      );
      const scrollLabelColor = resolveThemeColor(
        isFocused
          ? copyModeActive
            ? theme.pane.copyModeBorderColor
            : theme.pane.focusedBorderColor
          : theme.ui.mutedText,
        getCachedRGBA(160, 160, 160)
      );
      renderScrollDepth(buffer, {
        viewportOffset: renderViewportOffset,
        scrollbackLength: renderScrollbackLength,
        rows,
        cols,
        width,
        offsetX,
        offsetY,
        labelFg: scrollLabelColor,
      });
    }

    kittyRenderer?.updatePane(kittyPaneKey, {
      ptyId,
      emulator,
      offsetX,
      offsetY,
      width,
      height,
      cols,
      rows,
      viewportOffset: renderViewportOffset,
      scrollbackLength: renderScrollbackLength,
      isAlternateScreen: state.alternateScreen,
      layer: props.kittyLayer ?? 'base',
    });

    const _perfDt = performance.now() - _perfT0;
    _perfCount++;
    _perfAccum += _perfDt;
    const _perfNow = performance.now();
    if (_perfNow - _perfLastLog >= 2000) {
      const _fps = _perfCount / ((_perfNow - _perfLastLog) / 1000);
      console.log(
        `[render-perf] avg=${(_perfAccum / _perfCount).toFixed(2)}ms fps=${_fps.toFixed(1)} calls=${_perfCount} rows=${rows} cols=${cols}`
      );
      _perfCount = 0;
      _perfAccum = 0;
      _perfLastLog = _perfNow;
    }
  };
}
