/**
 * Pi flash suppression tests for data-handler
 * Verifies that pi's full redraw patterns are detected and smoothed out
 */

import { describe, it, expect } from 'bun:test';

// Constants from data-handler.ts (must match)
const PI_SYNC_START = '\x1b[?2026h';
const PI_SYNC_END = '\x1b[?2026l';

// Replicate the helper functions for testing
function suppressPiClearSequences(content: string): string {
  const CLEAR_SCREEN_REGEX = /\x1b\[2J/g;
  const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g;
  const SCROLLBACK_CLEAR_REGEX = /\x1b\[([0-9;]*)J/g;
  const SCROLLBACK_CLEAR_C1_REGEX = /\x9b([0-9;]*)J/g;

  return content
    .replace(CLEAR_SCREEN_REGEX, '')
    .replace(CLEAR_SCREEN_C1_REGEX, '')
    .replace(/\x1b\[H/g, '')
    .replace(/\x9bH/g, '')
    .replace(SCROLLBACK_CLEAR_REGEX, (match, params) => {
      const parts = (params ?? '').split(';').filter(Boolean);
      return parts.includes('3') ? '' : match;
    })
    .replace(SCROLLBACK_CLEAR_C1_REGEX, (match, params) => {
      const parts = (params ?? '').split(';').filter(Boolean);
      return parts.includes('3') ? '' : match;
    });
}

/**
 * Detect and suppress pi's full redraw pattern within synchronized output.
 * Matches the implementation in data-handler.ts
 */
function suppressPiFlashPattern(
  data: string,
  probeBuffer: string = ''
): { result: string; newProbeBuffer: string } {
  const PI_SYNC_PROBE_LEN = 512;
  const CLEAR_SCREEN_REGEX = /\x1b\[2J/g;
  const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g;
  const SCROLLBACK_CLEAR_REGEX = /\x1b\[3J/g;
  const SCROLLBACK_CLEAR_C1_REGEX = /\x9b3J/g;

  // Combine with probe buffer to handle split sequences
  const combined = probeBuffer + data;

  // Find sync block boundaries
  const syncStartIdx = combined.indexOf(PI_SYNC_START);
  if (syncStartIdx === -1) {
    // No sync marker found - buffer last 512 chars for future split detection
    return { result: data, newProbeBuffer: combined.slice(-PI_SYNC_PROBE_LEN) };
  }

  const syncEndIdx = combined.indexOf(PI_SYNC_END, syncStartIdx + PI_SYNC_START.length);

  // If we have a complete sync block with clears inside, suppress them
  if (syncEndIdx !== -1) {
    const beforeSync = combined.slice(0, syncStartIdx);
    const syncContent = combined.slice(syncStartIdx + PI_SYNC_START.length, syncEndIdx);
    const afterSync = combined.slice(syncEndIdx + PI_SYNC_END.length);

    // Check if there's a clear sequence within the sync block (indicates pi full redraw)
    const hasClearInSync =
      CLEAR_SCREEN_REGEX.test(syncContent) ||
      CLEAR_SCREEN_C1_REGEX.test(syncContent) ||
      SCROLLBACK_CLEAR_REGEX.test(syncContent) ||
      SCROLLBACK_CLEAR_C1_REGEX.test(syncContent);

    if (hasClearInSync) {
      // Suppress clears but keep content
      const cleanContent = suppressPiClearSequences(syncContent);
      const result = beforeSync + cleanContent + afterSync;
      return { result, newProbeBuffer: '' };
    }

    // Sync block but no clears - not pi's flash pattern
    return { result: combined, newProbeBuffer: '' };
  }

  // Incomplete sync block - buffer for next chunk
  return { result: data, newProbeBuffer: combined.slice(-PI_SYNC_PROBE_LEN) };
}

describe('pi flash suppression', () => {
  describe('suppressPiClearSequences', () => {
    it('should remove CSI 2 J from content', () => {
      const input = 'hello\x1b[2Jworld';
      const output = suppressPiClearSequences(input);
      expect(output).toBe('helloworld');
    });

    it('should remove CSI H (home) from content', () => {
      const input = 'hello\x1b[Hworld';
      const output = suppressPiClearSequences(input);
      expect(output).toBe('helloworld');
    });

    it('should remove CSI 3 J (scrollback clear) from content', () => {
      const input = 'hello\x1b[3Jworld';
      const output = suppressPiClearSequences(input);
      expect(output).toBe('helloworld');
    });

    it('should remove multiple clear sequences', () => {
      const input = 'a\x1b[2J\x1b[H\x1b[3Jb';
      const output = suppressPiClearSequences(input);
      expect(output).toBe('ab');
    });

    it('should not affect other CSI sequences', () => {
      const input = '\x1b[31mred\x1b[0m\x1b[2J\x1b[10;20H';
      const output = suppressPiClearSequences(input);
      expect(output).toBe('\x1b[31mred\x1b[0m\x1b[10;20H');
    });
  });

  describe('suppressPiFlashPattern', () => {
    it('should pass through data without sync markers', () => {
      const input = 'hello world\x1b[31mred text\x1b[0m';
      const { result, newProbeBuffer } = suppressPiFlashPattern(input);
      expect(result).toBe(input);
      expect(newProbeBuffer.length).toBeLessThanOrEqual(input.length);
    });

    it('should detect and suppress pi full redraw pattern', () => {
      // Pi's pattern: sync start -> clear screen -> home -> clear scrollback -> content -> sync end
      const input = '\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jnew content here\x1b[?2026l';
      const { result, newProbeBuffer } = suppressPiFlashPattern(input);

      // Should strip sync markers and clear sequences, keep content
      expect(result).toBe('new content here');
      expect(newProbeBuffer).toBe('');
    });

    it('should handle content before and after sync block', () => {
      const input = 'before\x1b[?2026h\x1b[2Jcontent\x1b[?2026lafter';
      const { result, newProbeBuffer } = suppressPiFlashPattern(input);

      expect(result).toBe('beforecontentafter');
      expect(newProbeBuffer).toBe('');
    });

    it('should handle incomplete sync start (buffered)', () => {
      const part1 = 'hello\x1b[?202';
      const part2 = '6h\x1b[2Jcontent\x1b[?2026l';

      const { result: r1, newProbeBuffer: b1 } = suppressPiFlashPattern(part1);
      expect(r1).toBe(part1); // Pass through, buffer incomplete
      expect(b1.length).toBeGreaterThan(0); // Should have buffered partial sequence

      const { result: r2, newProbeBuffer: b2 } = suppressPiFlashPattern(part2, b1);
      expect(r2).toBe('hellocontent');
      expect(b2).toBe('');
    });

    it('should handle incomplete sync end (buffered)', () => {
      const part1 = '\x1b[?2026h\x1b[2Jcontent\x1b[?2026';
      const part2 = 'lmore data';

      const { result: r1, newProbeBuffer: b1 } = suppressPiFlashPattern(part1);
      expect(r1).toBe(part1); // Pass through, buffer incomplete
      expect(b1.includes('\x1b[?2026h')).toBe(true);

      const { result: r2, newProbeBuffer: b2 } = suppressPiFlashPattern(part2, b1);
      expect(r2).toBe('contentmore data');
      expect(b2).toBe('');
    });

    it('should not suppress sync block without clears', () => {
      // Legitimate synchronized output without clears (not pi's flash)
      const input = '\x1b[?2026hcontent without clears\x1b[?2026l';
      const { result, newProbeBuffer } = suppressPiFlashPattern(input);

      // Should pass through intact
      expect(result).toBe(input);
      expect(newProbeBuffer).toBe('');
    });

    it('should handle multiple sync blocks', () => {
      // Note: Each call processes one complete sync block at a time
      const input = '\x1b[?2026h\x1b[2Jfirst\x1b[?2026lmiddle\x1b[?2026h\x1b[2Jsecond\x1b[?2026l';

      // First call processes first block
      const { result: r1, newProbeBuffer: b1 } = suppressPiFlashPattern(input);
      expect(r1).toBe('firstmiddle\x1b[?2026h\x1b[2Jsecond\x1b[?2026l');
      expect(b1).toBe('');

      // Second call processes second block
      const { result: r2, newProbeBuffer: b2 } = suppressPiFlashPattern(r1);
      expect(r2).toBe('firstmiddlesecond');
      expect(b2).toBe('');
    });
  });
});
