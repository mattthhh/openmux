import { describe, test, expect } from 'bun:test';
import { parseTerminalQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import {
  ESC,
  DSR_CPR_QUERY,
  DSR_STATUS_QUERY,
  DA1_QUERY,
  DA1_QUERY_FULL,
  DA2_QUERY,
  DA2_QUERY_FULL,
  DA3_QUERY,
  DA3_QUERY_FULL,
  XTVERSION_QUERY,
  XTVERSION_QUERY_FULL,
  DECXCPR_QUERY,
  KITTY_KEYBOARD_QUERY,
} from '../../../src/terminal/terminal-query-passthrough/constants';

describe('parseTerminalQueries', () => {
  describe('CPR query (ESC[6n)', () => {
    test('parses standalone CPR query', () => {
      const result = parseTerminalQueries(DSR_CPR_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual([]);
    });

    test('parses CPR query with text before', () => {
      const result = parseTerminalQueries(`prefix${DSR_CPR_QUERY}`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['prefix']);
    });

    test('parses CPR query with text after', () => {
      const result = parseTerminalQueries(`${DSR_CPR_QUERY}suffix`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['suffix']);
    });

    test('parses CPR query with text before and after', () => {
      const result = parseTerminalQueries(`prefix${DSR_CPR_QUERY}suffix`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.textSegments).toEqual(['prefix', 'suffix']);
    });
  });

  describe('Device Status query (ESC[5n)', () => {
    test('parses status query', () => {
      const result = parseTerminalQueries(DSR_STATUS_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('status');
    });
  });

  describe('Device Attributes queries', () => {
    test('parses DA1 query (ESC[c)', () => {
      const result = parseTerminalQueries(DA1_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da1');
    });

    test('parses DA1 full query (ESC[0c)', () => {
      const result = parseTerminalQueries(DA1_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da1');
    });

    test('parses DA2 query (ESC[>c)', () => {
      const result = parseTerminalQueries(DA2_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da2');
    });

    test('parses DA2 full query (ESC[>0c)', () => {
      const result = parseTerminalQueries(DA2_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da2');
    });

    test('parses DA3 query (ESC[=c)', () => {
      const result = parseTerminalQueries(DA3_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da3');
    });

    test('parses DA3 full query (ESC[=0c)', () => {
      const result = parseTerminalQueries(DA3_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('da3');
    });
  });

  describe('XTVERSION query (ESC[>q)', () => {
    test('parses XTVERSION query', () => {
      const result = parseTerminalQueries(XTVERSION_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtversion');
    });

    test('parses XTVERSION full query (ESC[>0q)', () => {
      const result = parseTerminalQueries(XTVERSION_QUERY_FULL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtversion');
    });
  });

  describe('DECXCPR query (ESC[?6n)', () => {
    test('parses DECXCPR query', () => {
      const result = parseTerminalQueries(DECXCPR_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decxcpr');
    });
  });

  describe('DECRQM query (ESC[?Ps$p)', () => {
    test('parses DECRQM query for mode 25', () => {
      const query = `${ESC}[?25$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(25);
    });

    test('parses DECRQM query for mode 1', () => {
      const query = `${ESC}[?1$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(1);
    });

    test('parses DECRQM query for mode 2004', () => {
      const query = `${ESC}[?2004$p`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqm');
      expect(result.queries[0].mode).toBe(2004);
    });
  });

  describe('Kitty Keyboard query (ESC[?u)', () => {
    test('parses Kitty keyboard query', () => {
      const result = parseTerminalQueries(KITTY_KEYBOARD_QUERY);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('kitty-keyboard');
    });
  });
});
