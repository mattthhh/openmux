/**
 * Tests for terminal query detection.
 */

import { describe, test, expect } from 'bun:test';
import { mightContainQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import {
  ESC,
  BEL,
  ST,
  DCS,
  DSR_CPR_QUERY,
  DSR_STATUS_QUERY,
  DA1_QUERY,
  DA2_QUERY,
  DA3_QUERY,
  XTVERSION_QUERY,
  KITTY_KEYBOARD_QUERY,
  XTWINOPS_14T,
  XTWINOPS_16T,
  XTWINOPS_18T,
  DECXCPR_QUERY,
  OSC_FG_QUERY_BEL,
  OSC_BG_QUERY_BEL,
} from '../../../src/terminal/terminal-query-passthrough/constants';

describe('mightContainQueries', () => {
  describe('returns false for regular text', () => {
    test('plain text without escapes', () => {
      expect(mightContainQueries('hello world')).toBe(false);
    });

    test('text with common characters', () => {
      expect(mightContainQueries('The quick brown fox jumps over the lazy dog')).toBe(false);
    });

    test('text with numbers', () => {
      expect(mightContainQueries('123456789')).toBe(false);
    });

    test('empty string', () => {
      expect(mightContainQueries('')).toBe(false);
    });
  });

  describe('returns true for CSI queries', () => {
    test('DSR CPR query (ESC[6n)', () => {
      expect(mightContainQueries(DSR_CPR_QUERY)).toBe(true);
    });

    test('DSR status query (ESC[5n)', () => {
      expect(mightContainQueries(DSR_STATUS_QUERY)).toBe(true);
    });

    test('DA1 query (ESC[c)', () => {
      expect(mightContainQueries(DA1_QUERY)).toBe(true);
    });

    test('DA2 query (ESC[>c)', () => {
      expect(mightContainQueries(DA2_QUERY)).toBe(true);
    });

    test('DA3 query (ESC[=c)', () => {
      expect(mightContainQueries(DA3_QUERY)).toBe(true);
    });

    test('XTVERSION query (ESC[>q)', () => {
      expect(mightContainQueries(XTVERSION_QUERY)).toBe(true);
    });

    test('DECRQM query ($p suffix)', () => {
      expect(mightContainQueries(`${ESC}[?25$p`)).toBe(true);
    });

    test('Kitty keyboard query (ESC[?u)', () => {
      expect(mightContainQueries(KITTY_KEYBOARD_QUERY)).toBe(true);
    });

    test('DECXCPR query (ESC[?6n)', () => {
      expect(mightContainQueries(DECXCPR_QUERY)).toBe(true);
    });

    test('XTWINOPS queries', () => {
      expect(mightContainQueries(XTWINOPS_14T)).toBe(true);
      expect(mightContainQueries(XTWINOPS_16T)).toBe(true);
      expect(mightContainQueries(XTWINOPS_18T)).toBe(true);
    });
  });

  describe('returns true for OSC queries', () => {
    test('OSC foreground query', () => {
      expect(mightContainQueries(OSC_FG_QUERY_BEL)).toBe(true);
    });

    test('OSC background query', () => {
      expect(mightContainQueries(OSC_BG_QUERY_BEL)).toBe(true);
    });

    test('OSC palette query', () => {
      expect(mightContainQueries(`${ESC}]4;0;?${BEL}`)).toBe(true);
    });

    test('OSC clipboard query', () => {
      expect(mightContainQueries(`${ESC}]52;c;?${BEL}`)).toBe(true);
    });

    test('OSC 66 query (to be dropped)', () => {
      expect(mightContainQueries(`${ESC}]66;w=1;${BEL}`)).toBe(true);
    });
  });

  describe('returns true for DCS queries', () => {
    test('XTGETTCAP query', () => {
      expect(mightContainQueries(`${DCS}+q${ST}`)).toBe(true);
    });

    test('DECRQSS query', () => {
      expect(mightContainQueries(`${DCS}$qm${ST}`)).toBe(true);
    });
  });

  describe('embedded in text', () => {
    test('query at start', () => {
      expect(mightContainQueries(`${DSR_CPR_QUERY}hello`)).toBe(true);
    });

    test('query at end', () => {
      expect(mightContainQueries(`hello${DSR_CPR_QUERY}`)).toBe(true);
    });

    test('query in middle', () => {
      expect(mightContainQueries(`hello${DSR_CPR_QUERY}world`)).toBe(true);
    });
  });
});
