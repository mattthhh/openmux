import type { OptimizedBuffer } from '@opentui/core';
import { isAtBottom as checkIsAtBottom } from '../../core/scroll-utils';
import { BLACK, getCachedRGBA, SELECTION_BG } from '../../terminal/rendering';
import { extractRgb, getDefaultColors, getHostColors } from '../../terminal/terminal-colors';
import { getKittyGraphicsRenderer } from '../../terminal/kitty-graphics';
import type { SelectionRange } from '../../core/coordinates';
import type { SearchMatch } from '../../contexts/search/types';
import {
  renderRow,
  renderScrollbar,
  renderScrollDepth,
  fetchRowsForRendering,
  calculatePrefetchRequest,
  guardScrollbackRender,
} from './index';
import { resolveThemeColor } from './theme-color';
import type { TerminalViewProps } from './types';
import type { TerminalViewState } from './view-state';

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

  return (buffer: OptimizedBuffer) => {
    const state = viewState.terminalState;
    const width = props.width;
    const height = props.height;
    const offsetX = props.offsetX ?? 0;
    const offsetY = props.offsetY ?? 0;
    const isFocused = props.isFocused;
    const ptyId = props.ptyId;
    const emulator = viewState.emulator;
    const kittyRenderer = getKittyGraphicsRenderer();

    if (!state) {
      const colors = getHostColors() ?? getDefaultColors();
      const rgb = extractRgb(colors.background);
      const fallbackBg = getCachedRGBA(rgb.r, rgb.g, rgb.b);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          buffer.setCell(x + offsetX, y + offsetY, ' ', BLACK, fallbackBg, 0);
        }
      }
      kittyRenderer?.removePane(kittyPaneKey);
      return;
    }

    const desiredViewportOffset = viewState.scrollState.viewportOffset;
    const desiredScrollbackLength = viewState.scrollState.scrollbackLength;

    const rows = Math.min(state.rows, height);
    const cols = Math.min(state.cols, width);
    const fallbackBgColor = state.cells?.[0]?.[0]?.bg ?? { r: 0, g: 0, b: 0 };
    const fallbackBg = getCachedRGBA(fallbackBgColor.r, fallbackBgColor.g, fallbackBgColor.b);
    const fallbackFg = BLACK;

    const {
      rowCache: desiredRowCache,
      firstMissingOffset,
      lastMissingOffset,
    } = fetchRowsForRendering(state, emulator, {
      viewportOffset: desiredViewportOffset,
      scrollbackLength: desiredScrollbackLength,
      rows,
    });

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
      renderRow(
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
  };
}
