/**
 * Tests for clear sequence suppression in PTY data handler.
 */

import { describe, it, expect } from 'bun:test';
import { suppressPiClearSequences, suppressClearScreenSequences } from '../data-handler';

describe('suppressPiClearSequences', () => {
  it('removes CSI 2 J (clear screen)', () => {
    const input = 'hello\x1b[2Jworld';
    expect(suppressPiClearSequences(input)).toBe('helloworld');
  });

  it('removes CSI H (home cursor)', () => {
    const input = 'hello\x1b[Hworld';
    expect(suppressPiClearSequences(input)).toBe('helloworld');
  });

  it('removes CSI 3 J (clear scrollback)', () => {
    const input = 'hello\x1b[3Jworld';
    expect(suppressPiClearSequences(input)).toBe('helloworld');
  });

  it('removes C1 CSI sequences', () => {
    const input = 'a\x9b2J\x9bH\x9b3Jb';
    expect(suppressPiClearSequences(input)).toBe('ab');
  });

  it('removes multiple clear sequences', () => {
    const input = 'a\x1b[2J\x1b[H\x1b[3Jb';
    expect(suppressPiClearSequences(input)).toBe('ab');
  });

  it('preserves other CSI sequences', () => {
    const input = '\x1b[31mred\x1b[0m\x1b[2J\x1b[10;20H';
    expect(suppressPiClearSequences(input)).toBe('\x1b[31mred\x1b[0m\x1b[10;20H');
  });

  it('handles empty string', () => {
    expect(suppressPiClearSequences('')).toBe('');
  });

  it('handles content without clear sequences', () => {
    const input = 'hello world\x1b[31mred\x1b[0m';
    expect(suppressPiClearSequences(input)).toBe(input);
  });
});

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
