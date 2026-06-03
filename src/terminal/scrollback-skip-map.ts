/**
 * ScrollbackSkipMap - virtual deduplication for pi full-redraw scrollback.
 *
 * Pi full redraws push duplicate content into scrollback via ghostty's
 * scrollClear heuristic (LF-triggered scrolls on the primary screen).
 * Instead of preventing the push (which requires deep VT-level changes)
 * or trimming post-write (which races with streaming data), we record
 * the duplicate ranges and filter them at read time.
 *
 * The map maintains a sorted list of non-overlapping [start, end) ranges
 * in raw scrollback offset space. All scrollback read paths translate
 * "effective" offsets (what the user sees) to "raw" offsets (what's in
 * the buffer) through this map, so duplicate content is invisible.
 *
 * Offset arithmetic:
 *   effectiveOffset → rawOffset (for getScrollbackLine)
 *   rawOffset → effectiveOffset (for kitty placements, search results)
 *   rawLength → effectiveLength (for scrollback length, scrollbar)
 */

export interface SkipRange {
  /** Start offset in raw scrollback space (inclusive) */
  start: number;
  /** End offset in raw scrollback space (exclusive) */
  end: number;
}

export class ScrollbackSkipMap {
  private ranges: SkipRange[] = [];

  /** Snapshot version — incremented on every mutation for cache invalidation. */
  private _version = 0;

  get version(): number {
    return this._version;
  }

  /** Number of skip ranges. */
  get size(): number {
    return this.ranges.length;
  }

  /** True if there are no skip ranges. */
  get isEmpty(): boolean {
    return this.ranges.length === 0;
  }

  /** Total number of skipped lines across all ranges. */
  get totalSkipped(): number {
    let total = 0;
    for (const r of this.ranges) {
      total += r.end - r.start;
    }
    return total;
  }

  /**
   * Add a skip range [start, end) in raw scrollback offset space.
   * Merges with any overlapping or adjacent existing ranges.
   */
  skipRange(start: number, end: number): void {
    if (start >= end) return;

    const newRange: SkipRange = { start, end };

    // Find insertion point and merge overlapping/adjacent ranges.
    const merged: SkipRange[] = [];
    let inserted = false;

    for (const existing of this.ranges) {
      if (inserted) {
        merged.push(existing);
        continue;
      }

      // newRange is entirely before existing
      if (newRange.end < existing.start) {
        merged.push(newRange);
        merged.push(existing);
        inserted = true;
        continue;
      }

      // existing is entirely before newRange
      if (existing.end < newRange.start) {
        merged.push(existing);
        continue;
      }

      // Overlapping or adjacent — merge into newRange
      newRange.start = Math.min(newRange.start, existing.start);
      newRange.end = Math.max(newRange.end, existing.end);
    }

    if (!inserted) {
      merged.push(newRange);
    }

    this.ranges = merged;
    this._version++;
  }

  /**
   * Remove all skip ranges that fall within [start, end).
   * Ranges that partially overlap are trimmed (left or right) or split.
   * Used when the archiver physically removes lines from the head of
   * scrollback — those lines (and their skip ranges) are gone.
   */
  clearRange(start: number, end: number): void {
    if (start >= end) return;

    const result: SkipRange[] = [];
    for (const r of this.ranges) {
      if (r.end <= start) {
        // Entirely before the cleared range — keep as-is
        result.push(r);
      } else if (r.start >= end) {
        // Entirely after — keep as-is
        result.push(r);
      } else if (r.start < start && r.end > end) {
        // Cleared range punches a hole — split into two
        result.push({ start: r.start, end: start });
        result.push({ start: end, end: r.end });
      } else if (r.start < start) {
        // Partial overlap on the left: [r.start, start) survives
        result.push({ start: r.start, end: start });
      } else if (r.end > end) {
        // Partial overlap on the right: [end, r.end) survives
        result.push({ start: end, end: r.end });
      }
      // else: fully contained in cleared range — drop
    }

    this.ranges = result;
    this._version++;
  }

  /**
   * Shift all skip ranges by `delta` (can be negative).
   * Used when lines are removed from the head of scrollback —
   * all offsets above the removal point shift down.
   *
   * @param fromOffset - Only shift ranges at or above this offset
   * @param delta - Number of lines to shift (negative = shift up)
   */
  shiftRanges(fromOffset: number, delta: number): void {
    if (delta === 0) return;

    const result: SkipRange[] = [];
    for (const r of this.ranges) {
      if (r.end <= fromOffset) {
        // Entirely below the shift point — no change
        result.push(r);
      } else if (r.start >= fromOffset) {
        // Entirely above — shift both bounds
        const newStart = r.start + delta;
        const newEnd = r.end + delta;
        if (newStart < newEnd && newStart >= 0) {
          result.push({ start: newStart, end: newEnd });
        }
        // If the shift makes the range invalid (negative start), drop it
      } else {
        // Straddles the shift point — split
        result.push({ start: r.start, end: fromOffset });
        const newEnd = r.end + delta;
        if (fromOffset < newEnd) {
          result.push({ start: fromOffset, end: newEnd });
        }
      }
    }

    this.ranges = result;
    this._version++;
  }

  /** Remove all skip ranges. */
  clear(): void {
    if (this.ranges.length === 0) return;
    this.ranges = [];
    this._version++;
  }

  /**
   * Compute effective scrollback length from raw length.
   * Effective = raw minus all skipped lines.
   */
  effectiveLength(rawLength: number): number {
    let skipped = 0;
    for (const r of this.ranges) {
      if (r.start >= rawLength) break;
      const effectiveEnd = Math.min(r.end, rawLength);
      skipped += effectiveEnd - r.start;
    }
    return rawLength - skipped;
  }

  /**
   * Convert an effective offset to a raw offset.
   * Effective offsets are what the UI layer uses (with skip ranges collapsed).
   * Raw offsets are what the emulator/archive use (with skip ranges present).
   */
  effectiveToRaw(effectiveOffset: number): number {
    let raw = effectiveOffset;
    for (const r of this.ranges) {
      if (raw < r.start) break;
      // The effective offset is past this skip range — it maps
      // to a raw offset that's further along by the range's size.
      raw += r.end - r.start;
    }
    return raw;
  }

  /**
   * Convert a raw offset to an effective offset.
   * Returns null if the raw offset falls inside a skip range (invisible).
   */
  rawToEffective(rawOffset: number): number | null {
    let effective = rawOffset;
    for (const r of this.ranges) {
      if (rawOffset < r.start) break;
      if (rawOffset < r.end) {
        // Inside a skip range — this line is invisible
        return null;
      }
      // Past this range — subtract its size from the effective offset
      effective -= r.end - r.start;
    }
    return effective;
  }

  /**
   * Check if a raw offset falls inside a skip range.
   */
  isSkipped(rawOffset: number): boolean {
    for (const r of this.ranges) {
      if (rawOffset < r.start) return false;
      if (rawOffset < r.end) return true;
    }
    return false;
  }

  /**
   * Get all skip ranges (read-only snapshot for iteration).
   */
  getRanges(): readonly SkipRange[] {
    return this.ranges;
  }
}
