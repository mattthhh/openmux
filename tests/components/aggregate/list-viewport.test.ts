import { describe, expect, it } from 'bun:test';
import {
  calculateAggregateListViewport,
  clampAggregateListScrollOffset,
  getAggregateListScrollOffsetForSelection,
} from '../../../src/components/aggregate/list-viewport';

describe('aggregate list viewport', () => {
  it('keeps the top indicator hidden while the selection is still on the last visible row', () => {
    const viewport = calculateAggregateListViewport({
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 0,
    });

    expect(viewport.showTopIndicator).toBe(false);
    expect(viewport.showBottomIndicator).toBe(true);
    expect(viewport.start).toBe(0);
    expect(viewport.end).toBe(9);

    const nextOffset = getAggregateListScrollOffsetForSelection({
      selectedIndex: 8,
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 0,
    });

    expect(nextOffset).toBe(0);
  });

  it('starts scrolling only after the selection moves past the last visible row', () => {
    const nextOffset = getAggregateListScrollOffsetForSelection({
      selectedIndex: 9,
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 0,
    });

    expect(nextOffset).toBe(2);

    const viewport = calculateAggregateListViewport({
      totalItems: 20,
      maxRows: 10,
      scrollOffset: nextOffset,
    });

    expect(viewport.showTopIndicator).toBe(true);
    expect(viewport.showBottomIndicator).toBe(true);
    expect(viewport.start).toBe(2);
    expect(viewport.end).toBe(10);
  });

  it('clamps oversized scroll offsets to the last stable viewport', () => {
    const offset = clampAggregateListScrollOffset({
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 999,
    });

    expect(offset).toBe(11);

    const viewport = calculateAggregateListViewport({
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 999,
    });

    expect(viewport.start).toBe(11);
    expect(viewport.end).toBe(20);
    expect(viewport.showTopIndicator).toBe(true);
    expect(viewport.showBottomIndicator).toBe(false);
  });

  it('prefers offset 0 when the selected item is visible at the top, avoiding an unnecessary top indicator', () => {
    // Selected item at index 1 is visible at offset 0 (no top indicator needed)
    const nextOffsetNearTop = getAggregateListScrollOffsetForSelection({
      selectedIndex: 1,
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 2,
    });

    // Should return 0, not 1 — at offset 0, item 1 is visible and no top
    // indicator is needed. The old behavior returned 1, which caused a
    // self-fulfilling prophecy: offset > 0 → top indicator takes a row →
    // fewer items fit → offset stays non-zero. This made "▲ 1 more" appear
    // even when the user was effectively at the top.
    expect(nextOffsetNearTop).toBe(0);

    const nextOffsetAtTop = getAggregateListScrollOffsetForSelection({
      selectedIndex: 0,
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 1,
    });

    expect(nextOffsetAtTop).toBe(0);
  });

  it('keeps all items visible when the list fits without scrolling', () => {
    const viewport = calculateAggregateListViewport({
      totalItems: 5,
      maxRows: 10,
      scrollOffset: 3,
    });

    expect(viewport.start).toBe(0);
    expect(viewport.end).toBe(5);
    expect(viewport.showTopIndicator).toBe(false);
    expect(viewport.showBottomIndicator).toBe(false);
    expect(viewport.hiddenAboveCount).toBe(0);
    expect(viewport.hiddenBelowCount).toBe(0);
  });

  it('avoids stuck top indicator when navigating up to first PTY (preview mode scenario)', () => {
    // Simulates: user scrolled down to a lower PTY, then navigates UP
    // to the first PTY (index 1) in preview mode. navigateToPrevPty skips
    // the session header at index 0, so the user is stuck at index 1.
    // The scroll should prefer offset 0 so no top indicator appears.
    const offsetFromMiddle = getAggregateListScrollOffsetForSelection({
      selectedIndex: 1,
      totalItems: 12,
      maxRows: 5,
      scrollOffset: 3,
    });

    // Item 1 IS visible at offset 0 (first page shows items 0-3 plus indicator)
    // so the function should return 0, not 1.
    expect(offsetFromMiddle).toBe(0);

    // Even with scrollOffset already at 1, navigating to index 1 should
    // scroll back to 0 since the item is visible there.
    const offsetFromOne = getAggregateListScrollOffsetForSelection({
      selectedIndex: 1,
      totalItems: 12,
      maxRows: 5,
      scrollOffset: 1,
    });

    expect(offsetFromOne).toBe(0);
  });

  it('scrolls down when the selected item is not on the first page', () => {
    // Item 5 is NOT visible at offset 0 (first page shows items 0-3)
    // so the function must scroll down, producing a top indicator.
    const offset = getAggregateListScrollOffsetForSelection({
      selectedIndex: 5,
      totalItems: 12,
      maxRows: 5,
      scrollOffset: 0,
    });

    expect(offset).toBeGreaterThan(0);

    const viewport = calculateAggregateListViewport({
      totalItems: 12,
      maxRows: 5,
      scrollOffset: offset,
    });

    expect(viewport.start).toBeLessThanOrEqual(5);
    expect(viewport.end).toBeGreaterThan(5);
  });
});
