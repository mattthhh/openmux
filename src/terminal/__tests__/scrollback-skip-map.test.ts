import { describe, expect, it } from 'bun:test';
import { ScrollbackSkipMap } from '../scrollback-skip-map';

describe('ScrollbackSkipMap', () => {
  describe('basic operations', () => {
    it('starts empty', () => {
      const map = new ScrollbackSkipMap();
      expect(map.isEmpty).toBe(true);
      expect(map.size).toBe(0);
      expect(map.totalSkipped).toBe(0);
    });

    it('adds a single skip range', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      expect(map.isEmpty).toBe(false);
      expect(map.size).toBe(1);
      expect(map.totalSkipped).toBe(10);
    });

    it('ignores empty or inverted ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 10);
      map.skipRange(20, 10);
      expect(map.isEmpty).toBe(true);
    });
  });

  describe('effectiveLength', () => {
    it('returns raw length when empty', () => {
      const map = new ScrollbackSkipMap();
      expect(map.effectiveLength(100)).toBe(100);
    });

    it('subtracts skipped lines', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      expect(map.effectiveLength(100)).toBe(90);
    });

    it('clips ranges that extend past rawLength', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(90, 110);
      expect(map.effectiveLength(100)).toBe(90);
    });

    it('handles multiple ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 15);
      map.skipRange(25, 30);
      expect(map.effectiveLength(100)).toBe(90);
    });
  });

  describe('effectiveToRaw', () => {
    it('is identity when map is empty', () => {
      const map = new ScrollbackSkipMap();
      expect(map.effectiveToRaw(0)).toBe(0);
      expect(map.effectiveToRaw(50)).toBe(50);
    });

    it('shifts offset past the skip range', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      // Effective offset 5 → raw 5 (before skip range)
      expect(map.effectiveToRaw(5)).toBe(5);
      // Effective offset 10 → raw 20 (past the 10-line gap)
      expect(map.effectiveToRaw(10)).toBe(20);
      // Effective offset 15 → raw 25
      expect(map.effectiveToRaw(15)).toBe(25);
    });

    it('handles offset before all skip ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(50, 60);
      expect(map.effectiveToRaw(0)).toBe(0);
      expect(map.effectiveToRaw(49)).toBe(49);
    });

    it('handles multiple skip ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 15); // 5 lines
      map.skipRange(20, 30); // 10 lines
      // Effective 0-9 → raw 0-9 (before first range)
      expect(map.effectiveToRaw(9)).toBe(9);
      // Effective 10-14 → raw 15-19 (between first and second range)
      expect(map.effectiveToRaw(10)).toBe(15);
      expect(map.effectiveToRaw(14)).toBe(19);
      // Effective 15+ → raw 30+ (past both ranges)
      expect(map.effectiveToRaw(15)).toBe(30);
      expect(map.effectiveToRaw(20)).toBe(35);
    });
  });

  describe('rawToEffective', () => {
    it('is identity when map is empty', () => {
      const map = new ScrollbackSkipMap();
      expect(map.rawToEffective(0)).toBe(0);
      expect(map.rawToEffective(50)).toBe(50);
    });

    it('returns null for offsets inside a skip range', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      expect(map.rawToEffective(5)).toBe(5);
      expect(map.rawToEffective(10)).toBeNull();
      expect(map.rawToEffective(15)).toBeNull();
      expect(map.rawToEffective(19)).toBeNull();
      expect(map.rawToEffective(20)).toBe(10);
    });

    it('adjusts offsets past the skip range', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      expect(map.rawToEffective(20)).toBe(10);
      expect(map.rawToEffective(25)).toBe(15);
    });

    it('handles multiple skip ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 15);
      map.skipRange(20, 30);
      expect(map.rawToEffective(9)).toBe(9);
      expect(map.rawToEffective(10)).toBeNull(); // inside first
      expect(map.rawToEffective(15)).toBe(10);
      expect(map.rawToEffective(19)).toBe(14);
      expect(map.rawToEffective(20)).toBeNull(); // inside second
      expect(map.rawToEffective(30)).toBe(15);
      expect(map.rawToEffective(35)).toBe(20);
    });
  });

  describe('isSkipped', () => {
    it('returns false when empty', () => {
      const map = new ScrollbackSkipMap();
      expect(map.isSkipped(5)).toBe(false);
    });

    it('returns true for offsets inside skip ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      expect(map.isSkipped(5)).toBe(false);
      expect(map.isSkipped(10)).toBe(true);
      expect(map.isSkipped(15)).toBe(true);
      expect(map.isSkipped(19)).toBe(true);
      expect(map.isSkipped(20)).toBe(false);
    });
  });

  describe('range merging', () => {
    it('merges overlapping ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.skipRange(15, 25);
      expect(map.size).toBe(1);
      expect(map.totalSkipped).toBe(15);
      expect(map.effectiveLength(100)).toBe(85);
    });

    it('merges adjacent ranges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.skipRange(20, 30);
      expect(map.size).toBe(1);
      expect(map.totalSkipped).toBe(20);
    });

    it('merges ranges added in reverse order', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(20, 30);
      map.skipRange(10, 20);
      expect(map.size).toBe(1);
      expect(map.totalSkipped).toBe(20);
    });

    it('merges a range that subsumes existing ones', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 15);
      map.skipRange(25, 30);
      map.skipRange(5, 35);
      expect(map.size).toBe(1);
      expect(map.totalSkipped).toBe(30);
    });

    it('keeps non-overlapping ranges separate', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 15);
      map.skipRange(25, 30);
      expect(map.size).toBe(2);
    });
  });

  describe('clearRange', () => {
    it('removes ranges entirely within the cleared region', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.clearRange(5, 25);
      expect(map.isEmpty).toBe(true);
    });

    it('trims ranges that partially overlap', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 30);
      // Clear 5-15: trims the left side of the range
      map.clearRange(5, 15);
      expect(map.size).toBe(1);
      expect(map.getRanges()[0]).toEqual({ start: 15, end: 30 });
    });

    it('splits ranges when cleared range punches a hole', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 30);
      map.clearRange(15, 25);
      expect(map.size).toBe(2);
      expect(map.getRanges()[0]).toEqual({ start: 10, end: 15 });
      expect(map.getRanges()[1]).toEqual({ start: 25, end: 30 });
    });

    it('leaves unrelated ranges untouched', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.skipRange(50, 60);
      map.clearRange(0, 5);
      expect(map.size).toBe(2);
    });
  });

  describe('shiftRanges', () => {
    it('shifts ranges above the fromOffset', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(30, 40);
      map.shiftRanges(20, -10);
      // Range was above fromOffset=20, so it shifts down by 10
      expect(map.getRanges()[0]).toEqual({ start: 20, end: 30 });
    });

    it('leaves ranges below the fromOffset unchanged', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(5, 10);
      map.shiftRanges(20, -10);
      expect(map.getRanges()[0]).toEqual({ start: 5, end: 10 });
    });

    it('splits ranges that straddle the fromOffset', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(15, 30);
      map.shiftRanges(20, -5);
      expect(map.size).toBe(2);
      expect(map.getRanges()[0]).toEqual({ start: 15, end: 20 });
      expect(map.getRanges()[1]).toEqual({ start: 20, end: 25 });
    });

    it('drops ranges that become invalid after shift', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(5, 10);
      map.shiftRanges(0, -10);
      // Range shifts to (-5, 0) which is invalid — dropped
      expect(map.isEmpty).toBe(true);
    });
  });

  describe('version tracking', () => {
    it('increments version on skipRange', () => {
      const map = new ScrollbackSkipMap();
      const v0 = map.version;
      map.skipRange(10, 20);
      expect(map.version).toBeGreaterThan(v0);
    });

    it('increments version on clearRange', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      const v0 = map.version;
      map.clearRange(10, 20);
      expect(map.version).toBeGreaterThan(v0);
    });

    it('increments version on shiftRanges', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      const v0 = map.version;
      map.shiftRanges(0, -5);
      expect(map.version).toBeGreaterThan(v0);
    });

    it('increments version on clear', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      const v0 = map.version;
      map.clear();
      expect(map.version).toBeGreaterThan(v0);
    });

    it('does not increment on no-op clear', () => {
      const map = new ScrollbackSkipMap();
      const v0 = map.version;
      map.clear();
      expect(map.version).toBe(v0);
    });
  });

  describe('round-trip consistency', () => {
    it('effectiveToRaw and rawToEffective are inverses for visible lines', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.skipRange(35, 45);

      // For every effective offset, effectiveToRaw gives a raw offset
      // that is visible (rawToEffective returns the original effective offset)
      const effectiveLen = map.effectiveLength(100);
      for (let e = 0; e < effectiveLen; e++) {
        const raw = map.effectiveToRaw(e);
        const roundTrip = map.rawToEffective(raw);
        expect(roundTrip).toBe(e);
      }
    });

    it('no effective offset maps to a skipped raw offset', () => {
      const map = new ScrollbackSkipMap();
      map.skipRange(10, 20);
      map.skipRange(35, 45);

      const effectiveLen = map.effectiveLength(100);
      for (let e = 0; e < effectiveLen; e++) {
        const raw = map.effectiveToRaw(e);
        expect(map.isSkipped(raw)).toBe(false);
      }
    });
  });

  describe('archive chunk drop scenario', () => {
    it('adjusts a [0, X) skip range when an archive chunk is dropped', () => {
      const map = new ScrollbackSkipMap();

      // Pi redraw hid [0, 5000). Raw scrollback = 5024 (24 new-frame rows).
      map.skipRange(0, 5000);
      expect(map.effectiveLength(5024)).toBe(24);

      // Archive drops oldest chunk: 500 lines [0, 500) are removed.
      // clearRange(0, 500) truncates our range: [0, 5000) → [500, 5000).
      map.clearRange(0, 500);
      expect(map.size).toBe(1);
      expect(map.getRanges()[0]).toEqual({ start: 500, end: 5000 });

      // shiftRanges shifts all ranges at or above 500 down by 500.
      // [500, 5000) → [0, 4500).
      map.shiftRanges(500, -500);
      expect(map.getRanges()[0]).toEqual({ start: 0, end: 4500 });
      // Raw scrollback is now 5024 - 500 = 4524. Effective = 4524 - 4500 = 24.
      expect(map.effectiveLength(4524)).toBe(24);
    });

    it('clears skip ranges that overlap a dropped chunk', () => {
      const map = new ScrollbackSkipMap();

      // Skip range starts in the chunk that's being dropped.
      // Archive [0, 1000). Skip range [400, 600).
      map.skipRange(400, 600);

      // Drop chunk [0, 500): clearRange trims the left side of the range.
      // [400, 600) overlaps [0, 500) on [400, 500). That part is cleared,
      // leaving [500, 600).
      map.clearRange(0, 500);
      expect(map.getRanges()[0]).toEqual({ start: 500, end: 600 });

      // Then shift ranges above 500 down by 500.
      map.shiftRanges(500, -500);
      expect(map.getRanges()[0]).toEqual({ start: 0, end: 100 });
      expect(map.effectiveLength(100)).toBe(0);
    });

    it('drops skip ranges entirely within a dropped chunk', () => {
      const map = new ScrollbackSkipMap();

      // Skip range entirely within the chunk being dropped.
      map.skipRange(200, 300);
      map.skipRange(800, 900);

      // Drop chunk [0, 500).
      map.clearRange(0, 500);
      // First range is entirely within [0, 500) — dropped.
      // Second range is outside — kept.
      expect(map.size).toBe(1);
      expect(map.getRanges()[0]).toEqual({ start: 800, end: 900 });

      map.shiftRanges(500, -500);
      expect(map.getRanges()[0]).toEqual({ start: 300, end: 400 });
    });
  });

  describe('pi redraw scenario', () => {
    it('models first pi full redraw hiding old scrollback', () => {
      const map = new ScrollbackSkipMap();

      // Before pi redraw: 100 lines of scrollback at the old width.
      // Pi redraw pushes 24 new-frame rows. Total raw = 124.
      // skipRange(0, 100) hides old, keeps new push.
      map.skipRange(0, 100);
      expect(map.effectiveLength(124)).toBe(24); // only latest frame rows visible
    });

    it('models second pi full redraw replacing previous frame', () => {
      const map = new ScrollbackSkipMap();

      // First pi redraw: skip [0, 100). Raw 124. Effective 24.
      map.skipRange(0, 100);
      expect(map.effectiveLength(124)).toBe(24);

      // Second pi redraw: the previous 124 lines are now stale.
      // New push takes scrollback from 124 → 150 (26 new-frame rows).
      // skipRange(0, 124) merges with [0, 100) → [0, 124).
      map.skipRange(0, 124);
      expect(map.effectiveLength(150)).toBe(26); // only latest frame rows
    });

    it('adjusts viewport correctly: user scrolled up before redraw', () => {
      const map = new ScrollbackSkipMap();
      // 50 lines of old scrollback, user was scrolled up 10 lines
      // Pi redraw replaces it with 24 lines at the new width.
      map.skipRange(0, 50);

      // Effective scrollback = raw 74 - 50 = 24
      const effectiveLength = map.effectiveLength(74);
      expect(effectiveLength).toBe(24);

      // User at bottom (effective 0) sees the new frame bottom
      expect(map.rawToEffective(50)).toBe(0);
      expect(map.effectiveToRaw(0)).toBe(50);
    });
  });
});
