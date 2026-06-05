/**
 * Tests for clear sequence suppression in PTY data handler.
 */

import { describe, expect, it } from 'bun:test';
import { suppressClearScreenSequences } from '../data-handler';

describe('suppressClearScreenSequences', () => {
  it('removes CSI 2 J', () => {
    const input = 'hello\x1b[2Jworld';
    expect(suppressClearScreenSequences(input)).toBe('helloworld');
  });

  it('removes C1 CSI 2 J', () => {
    const input = 'a\x9b2Jb';
    expect(suppressClearScreenSequences(input)).toBe('ab');
  });

  it('preserves other sequences', () => {
    const input = '\x1b[31mred\x1b[0m\x1b[2J';
    expect(suppressClearScreenSequences(input)).toBe('\x1b[31mred\x1b[0m');
  });

  it('handles empty string', () => {
    expect(suppressClearScreenSequences('')).toBe('');
  });
});
