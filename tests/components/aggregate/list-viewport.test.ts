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

  it('moves back toward the top without introducing extra upward jumps', () => {
    const nextOffsetNearTop = getAggregateListScrollOffsetForSelection({
      selectedIndex: 1,
      totalItems: 20,
      maxRows: 10,
      scrollOffset: 2,
    });

    expect(nextOffsetNearTop).toBe(1);

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
});
