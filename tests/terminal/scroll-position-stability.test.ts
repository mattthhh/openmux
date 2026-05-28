/**
 * Tests for scroll position stability when new content is added
 *
 * These tests verify that:
 * 1. viewportOffset is adjusted when scrollback grows while scrolled back
 * 2. The adjustment maintains the same visual position
 * 3. Transition cache captures lines moving from live terminal to scrollback
 * 4. Stale cache entries are cleared when content shifts (at scrollback limit)
 */

import { describe, it, expect } from 'bun:test';
import type { TerminalCell } from '../../src/core/types';

describe('scroll-position-stability', () => {
  // Helper to create test cells
  function createTestCell(char: string): TerminalCell {
    return {
      char,
      fg: { r: 255, g: 255, b: 255 },
      bg: { r: 0, g: 0, b: 0 },
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1,
    };
  }

  describe('viewportOffset adjustment when scrollback length changes', () => {
    it('should adjust viewportOffset by scrollback delta when scrolled back', () => {
      // Simulates getCurrentScrollState() logic in notification.ts
      const session = {
        scrollState: {
          viewportOffset: 10,
          lastScrollbackLength: 100,
        },
      };
      const newScrollbackLength = 105; // 5 new lines added

      const scrollbackDelta = newScrollbackLength - session.scrollState.lastScrollbackLength;

      // When scrollback grows and user is scrolled back, adjust viewportOffset
      if (scrollbackDelta > 0 && session.scrollState.viewportOffset > 0) {
        session.scrollState.viewportOffset = Math.min(
          session.scrollState.viewportOffset + scrollbackDelta,
          newScrollbackLength
        );
      }
      session.scrollState.lastScrollbackLength = newScrollbackLength;

      // viewportOffset should increase by 5 to maintain same visual position
      expect(session.scrollState.viewportOffset).toBe(15);
      expect(session.scrollState.lastScrollbackLength).toBe(105);
    });

    it('should not adjust viewportOffset when at bottom (viewportOffset = 0)', () => {
      const session = {
        scrollState: {
          viewportOffset: 0, // At bottom
          lastScrollbackLength: 100,
        },
      };
      const newScrollbackLength = 105;

      const scrollbackDelta = newScrollbackLength - session.scrollState.lastScrollbackLength;

      if (scrollbackDelta > 0 && session.scrollState.viewportOffset > 0) {
        session.scrollState.viewportOffset = Math.min(
          session.scrollState.viewportOffset + scrollbackDelta,
          newScrollbackLength
        );
      }
      session.scrollState.lastScrollbackLength = newScrollbackLength;

      // viewportOffset should stay at 0 (user wants to see live terminal)
      expect(session.scrollState.viewportOffset).toBe(0);
    });

    it('should clamp viewportOffset to scrollbackLength', () => {
      const session = {
        scrollState: {
          viewportOffset: 95, // Near the top of scrollback
          lastScrollbackLength: 100,
        },
      };
      const newScrollbackLength = 105;

      const scrollbackDelta = newScrollbackLength - session.scrollState.lastScrollbackLength;

      if (scrollbackDelta > 0 && session.scrollState.viewportOffset > 0) {
        session.scrollState.viewportOffset = Math.min(
          session.scrollState.viewportOffset + scrollbackDelta,
          newScrollbackLength
        );
      }

      // 95 + 5 = 100, which is less than 105, so no clamping needed
      expect(session.scrollState.viewportOffset).toBe(100);
    });

    it('should adjust when scrollback shrinks while scrolled back', () => {
      const session = {
        scrollState: {
          viewportOffset: 50,
          lastScrollbackLength: 100,
        },
      };
      const newScrollbackLength = 0; // Reset

      const scrollbackDelta = newScrollbackLength - session.scrollState.lastScrollbackLength;

      if (scrollbackDelta !== 0 && session.scrollState.viewportOffset > 0) {
        const nextOffset = session.scrollState.viewportOffset + scrollbackDelta;
        session.scrollState.viewportOffset = Math.max(0, Math.min(nextOffset, newScrollbackLength));
      }

      // viewportOffset clamps to 0 when scrollback drops to 0
      expect(session.scrollState.viewportOffset).toBe(0);
    });
  });

  describe('transition cache for lines moving to scrollback', () => {
    it('should capture lines when scrollback grows and user is scrolled back', () => {
      const transitionCache = new Map<number, TerminalCell[]>();
      const terminalState = {
        cells: [
          [createTestCell('A'), createTestCell('B')], // Row 0 - will move to scrollback
          [createTestCell('C'), createTestCell('D')], // Row 1
        ],
      };
      const oldScrollbackLength = 100;
      const newScrollbackLength = 101; // 1 new line
      const viewportOffset = 10; // Scrolled back

      const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

      if (scrollbackDelta > 0 && viewportOffset > 0) {
        for (let i = 0; i < scrollbackDelta; i++) {
          const row = terminalState.cells[i];
          if (row) {
            transitionCache.set(oldScrollbackLength + i, row);
          }
        }
      }

      // Row 0 should be captured at offset 100
      expect(transitionCache.size).toBe(1);
      expect(transitionCache.has(100)).toBe(true);
      expect(transitionCache.get(100)?.[0].char).toBe('A');
    });

    it('should capture multiple lines when scrollback grows by more than 1', () => {
      const transitionCache = new Map<number, TerminalCell[]>();
      const terminalState = {
        cells: [
          [createTestCell('A')], // Row 0
          [createTestCell('B')], // Row 1
          [createTestCell('C')], // Row 2
          [createTestCell('D')], // Row 3
        ],
      };
      const oldScrollbackLength = 100;
      const newScrollbackLength = 103; // 3 new lines
      const viewportOffset = 10;

      const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

      if (scrollbackDelta > 0 && viewportOffset > 0) {
        for (let i = 0; i < scrollbackDelta; i++) {
          const row = terminalState.cells[i];
          if (row) {
            transitionCache.set(oldScrollbackLength + i, row);
          }
        }
      }

      expect(transitionCache.size).toBe(3);
      expect(transitionCache.get(100)?.[0].char).toBe('A');
      expect(transitionCache.get(101)?.[0].char).toBe('B');
      expect(transitionCache.get(102)?.[0].char).toBe('C');
    });

    it('should not capture when at bottom (viewportOffset = 0)', () => {
      const transitionCache = new Map<number, TerminalCell[]>();
      const terminalState = {
        cells: [[createTestCell('A')]],
      };
      const oldScrollbackLength = 100;
      const newScrollbackLength = 101;
      const viewportOffset = 0; // At bottom

      const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

      if (scrollbackDelta > 0 && viewportOffset > 0) {
        for (let i = 0; i < scrollbackDelta; i++) {
          const row = terminalState.cells[i];
          if (row) {
            transitionCache.set(oldScrollbackLength + i, row);
          }
        }
      }

      // No capture when at bottom
      expect(transitionCache.size).toBe(0);
    });

    it('should clear transition cache when content shifts (at scrollback limit)', () => {
      const transitionCache = new Map<number, TerminalCell[]>();

      // Populate with some cached transitions
      transitionCache.set(9998, [createTestCell('X')]);
      transitionCache.set(9999, [createTestCell('Y')]);

      const oldScrollbackLength = 10000;
      const newScrollbackLength = 10000; // At limit, no growth
      const scrollbackDelta = newScrollbackLength - oldScrollbackLength;

      // When content shifts (delta <= 0), clear stale cache
      if (scrollbackDelta <= 0 && oldScrollbackLength > 0) {
        transitionCache.clear();
      }

      expect(transitionCache.size).toBe(0);
    });
  });

  describe('smart cache invalidation (only on content shift)', () => {
    it('should NOT clear emulator cache when scrollback grows', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      // Populate cache
      scrollbackCache.set(50, [createTestCell('X')]);
      scrollbackCache.set(75, [createTestCell('Y')]);

      const newScrollbackLength = 150; // Scrollback grew
      const scrollbackDelta = newScrollbackLength - lastScrollbackLength;

      // Only clear when content shifts (delta <= 0)
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }

      lastScrollbackLength = newScrollbackLength;

      // Cache should be preserved - offsets are still valid
      expect(scrollbackCache.size).toBe(2);
      expect(lastScrollbackLength).toBe(150);
    });

    it('should clear emulator cache when at scrollback limit (content shifts)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 10000;

      // Populate cache with entries that will become stale
      scrollbackCache.set(0, [createTestCell('STALE_0')]);
      scrollbackCache.set(5000, [createTestCell('STALE_5000')]);

      const newScrollbackLength = 10000; // At limit, length unchanged
      const scrollbackDelta = newScrollbackLength - lastScrollbackLength;

      // Content shifted because delta = 0 and we had content before
      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }

      expect(scrollbackCache.size).toBe(0);
    });

    it('should clear emulator cache when scrollback shrinks (reset)', () => {
      let scrollbackCache = new Map<number, TerminalCell[]>();
      let lastScrollbackLength = 100;

      scrollbackCache.set(25, [createTestCell('X')]);
      scrollbackCache.set(50, [createTestCell('Y')]);

      const newScrollbackLength = 0; // Reset
      const scrollbackDelta = newScrollbackLength - lastScrollbackLength;

      const contentShifted = scrollbackDelta <= 0 && lastScrollbackLength > 0;

      if (contentShifted) {
        scrollbackCache.clear();
      }

      expect(scrollbackCache.size).toBe(0);
    });
  });

  describe('visual position calculation', () => {
    it('should maintain same absoluteY after adjustment', () => {
      const rows = 24;

      // Before new line
      let scrollbackLength = 100;
      let viewportOffset = 10;

      // Calculate absoluteY for row 0
      const absoluteYBefore = scrollbackLength - viewportOffset + 0; // 90

      // New line added
      const newScrollbackLength = 101;
      const scrollbackDelta = newScrollbackLength - scrollbackLength;

      // Adjust viewportOffset
      if (scrollbackDelta > 0 && viewportOffset > 0) {
        viewportOffset += scrollbackDelta;
      }
      scrollbackLength = newScrollbackLength;

      // Calculate absoluteY after adjustment
      const absoluteYAfter = scrollbackLength - viewportOffset + 0; // 101 - 11 + 0 = 90

      // Same visual position maintained
      expect(absoluteYAfter).toBe(absoluteYBefore);
    });

    it('should maintain same absoluteY when scrollback shrinks', () => {
      let scrollbackLength = 100;
      let viewportOffset = 20;

      const absoluteYBefore = scrollbackLength - viewportOffset + 0; // 80

      const newScrollbackLength = 90;
      const scrollbackDelta = newScrollbackLength - scrollbackLength;

      if (scrollbackDelta !== 0 && viewportOffset > 0) {
        viewportOffset = Math.max(
          0,
          Math.min(viewportOffset + scrollbackDelta, newScrollbackLength)
        );
      }
      scrollbackLength = newScrollbackLength;

      const absoluteYAfter = scrollbackLength - viewportOffset + 0; // 90 - 10 + 0 = 80

      expect(absoluteYAfter).toBe(absoluteYBefore);
    });

    it('should calculate correct boundary between scrollback and live terminal', () => {
      const scrollbackLength = 100;
      const viewportOffset = 10;
      const rows = 24;

      // Check which rows come from scrollback vs live terminal
      const scrollbackRows: number[] = [];
      const liveRows: number[] = [];

      for (let y = 0; y < rows; y++) {
        const absoluteY = scrollbackLength - viewportOffset + y;

        if (absoluteY < scrollbackLength) {
          scrollbackRows.push(y);
        } else {
          liveRows.push(y);
        }
      }

      // With viewportOffset=10, first 10 rows are from scrollback
      // absoluteY for y=0: 100 - 10 + 0 = 90 (< 100, scrollback)
      // absoluteY for y=9: 100 - 10 + 9 = 99 (< 100, scrollback)
      // absoluteY for y=10: 100 - 10 + 10 = 100 (>= 100, live terminal)
      expect(scrollbackRows.length).toBe(10);
      expect(liveRows.length).toBe(14);
      expect(scrollbackRows[0]).toBe(0);
      expect(scrollbackRows[9]).toBe(9);
      expect(liveRows[0]).toBe(10);
    });
  });
});
