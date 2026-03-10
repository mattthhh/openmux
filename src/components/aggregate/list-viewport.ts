export interface AggregateListViewportParams {
  totalItems: number;
  maxRows: number;
  scrollOffset: number;
}

export interface AggregateListViewport extends AggregateListViewportParams {
  start: number;
  end: number;
  visibleCount: number;
  showTopIndicator: boolean;
  showBottomIndicator: boolean;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
}

export function clampAggregateListScrollOffset(
  params: AggregateListViewportParams
): number {
  const { totalItems, maxRows, scrollOffset } = params;

  if (totalItems <= 0 || maxRows <= 0 || totalItems <= maxRows) {
    return 0;
  }

  const showTopIndicator = scrollOffset > 0;
  const rowsWithoutBottomIndicator = Math.max(1, maxRows - (showTopIndicator ? 1 : 0));
  const maxStart = Math.max(0, totalItems - rowsWithoutBottomIndicator);

  return Math.max(0, Math.min(scrollOffset, maxStart));
}

export function calculateAggregateListViewport(
  params: AggregateListViewportParams
): AggregateListViewport {
  const { totalItems, maxRows, scrollOffset } = params;

  if (totalItems <= 0 || maxRows <= 0) {
    return {
      totalItems,
      maxRows,
      scrollOffset,
      start: 0,
      end: 0,
      visibleCount: 0,
      showTopIndicator: false,
      showBottomIndicator: false,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    };
  }

  if (totalItems <= maxRows) {
    return {
      totalItems,
      maxRows,
      scrollOffset,
      start: 0,
      end: totalItems,
      visibleCount: totalItems,
      showTopIndicator: false,
      showBottomIndicator: false,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    };
  }

  const start = clampAggregateListScrollOffset(params);
  const showTopIndicator = start > 0;
  const rowsWithoutBottomIndicator = Math.max(1, maxRows - (showTopIndicator ? 1 : 0));
  const showBottomIndicator = start + rowsWithoutBottomIndicator < totalItems;
  const visibleCount = Math.max(1, rowsWithoutBottomIndicator - (showBottomIndicator ? 1 : 0));
  const end = Math.min(totalItems, start + visibleCount);

  return {
    totalItems,
    maxRows,
    scrollOffset,
    start,
    end,
    visibleCount,
    showTopIndicator,
    showBottomIndicator,
    hiddenAboveCount: start,
    hiddenBelowCount: Math.max(0, totalItems - end),
  };
}

export interface AggregateSelectionScrollParams extends AggregateListViewportParams {
  selectedIndex: number;
}

export function getAggregateListScrollOffsetForSelection(
  params: AggregateSelectionScrollParams
): number {
  const { totalItems, maxRows, selectedIndex } = params;

  if (totalItems <= 0 || maxRows <= 0) {
    return 0;
  }

  const clampedSelectedIndex = Math.max(0, Math.min(selectedIndex, totalItems - 1));
  const currentViewport = calculateAggregateListViewport(params);

  if (clampedSelectedIndex < currentViewport.start) {
    return clampAggregateListScrollOffset({
      totalItems,
      maxRows,
      scrollOffset: clampedSelectedIndex,
    });
  }

  if (clampedSelectedIndex < currentViewport.end) {
    return currentViewport.start;
  }

  let nextOffset = clampAggregateListScrollOffset({
    totalItems,
    maxRows,
    scrollOffset: clampedSelectedIndex - (currentViewport.visibleCount - 1),
  });

  let nextViewport = calculateAggregateListViewport({
    totalItems,
    maxRows,
    scrollOffset: nextOffset,
  });

  if (clampedSelectedIndex < nextViewport.end) {
    return nextViewport.start;
  }

  nextOffset = clampAggregateListScrollOffset({
    totalItems,
    maxRows,
    scrollOffset: nextViewport.start + (clampedSelectedIndex - (nextViewport.end - 1)),
  });

  nextViewport = calculateAggregateListViewport({
    totalItems,
    maxRows,
    scrollOffset: nextOffset,
  });

  return nextViewport.start;
}
