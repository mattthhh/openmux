import { describe, test, expect } from 'bun:test';
import { parseTerminalQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import {
  BEL,
  ESC,
  ST,
  OSC_FG_QUERY_BEL,
  OSC_FG_QUERY_ST,
  OSC_BG_QUERY_BEL,
  OSC_BG_QUERY_ST,
  OSC_CURSOR_QUERY_BEL,
  OSC_CURSOR_QUERY_ST,
} from '../../../src/terminal/terminal-query-passthrough/constants';

describe('parseTerminalQueries', () => {
  describe('OSC color queries', () => {
    test('parses OSC 10 foreground query with BEL', () => {
      const result = parseTerminalQueries(OSC_FG_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-fg');
    });

    test('parses OSC 10 foreground query with ST', () => {
      const result = parseTerminalQueries(OSC_FG_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-fg');
    });

    test('parses OSC 11 background query with BEL', () => {
      const result = parseTerminalQueries(OSC_BG_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-bg');
    });

    test('parses OSC 11 background query with ST', () => {
      const result = parseTerminalQueries(OSC_BG_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-bg');
    });

    test('parses OSC 12 cursor color query with BEL', () => {
      const result = parseTerminalQueries(OSC_CURSOR_QUERY_BEL);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-cursor');
    });

    test('parses OSC 12 cursor color query with ST', () => {
      const result = parseTerminalQueries(OSC_CURSOR_QUERY_ST);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-cursor');
    });
  });

  describe('OSC 4 palette query', () => {
    test('parses OSC 4 palette query with BEL', () => {
      const query = `${ESC}]4;0;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(0);
    });

    test('parses OSC 4 palette query with ST', () => {
      const query = `${ESC}]4;15;?${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(15);
    });

    test('parses OSC 4 palette query for color 255', () => {
      const query = `${ESC}]4;255;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-palette');
      expect(result.queries[0].colorIndex).toBe(255);
    });
  });

  describe('OSC 52 clipboard query', () => {
    test('parses OSC 52 clipboard query for clipboard', () => {
      const query = `${ESC}]52;c;?${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-clipboard');
      expect(result.queries[0].clipboardSelection).toBe('c');
    });

    test('parses OSC 52 clipboard query for primary', () => {
      const query = `${ESC}]52;p;?${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-clipboard');
      expect(result.queries[0].clipboardSelection).toBe('p');
    });
  });

  describe('OSC drop parser (filters unknown OSC sequences like OSC 66)', () => {
    test('filters OSC 66 with BEL terminator', () => {
      const result = parseTerminalQueries(`${ESC}]66;w=1;${BEL}`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-drop');
      expect(result.textSegments).toEqual([]);
    });

    test('filters OSC 66 with ST terminator', () => {
      const result = parseTerminalQueries(`${ESC}]66;s=2;${ST}`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-drop');
      expect(result.textSegments).toEqual([]);
    });

    test('filters multiple OSC 66 sequences', () => {
      const result = parseTerminalQueries(`${ESC}]66;w=1;${BEL}${ESC}]66;s=2;${BEL}`);
      expect(result.queries).toHaveLength(2);
      expect(result.queries[0].type).toBe('osc-drop');
      expect(result.queries[1].type).toBe('osc-drop');
      expect(result.textSegments).toEqual([]);
    });

    test('preserves text around OSC 66 sequences', () => {
      const result = parseTerminalQueries(`hello${ESC}]66;w=1;${BEL}world`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('osc-drop');
      expect(result.textSegments).toEqual(['hello', 'world']);
    });

    test('does NOT filter handled OSC codes (10, 11, 12)', () => {
      // These should be parsed as specific osc types, not osc-drop
      const resultFg = parseTerminalQueries(`${ESC}]10;?${BEL}`);
      expect(resultFg.queries[0].type).toBe('osc-fg');

      const resultBg = parseTerminalQueries(`${ESC}]11;?${BEL}`);
      expect(resultBg.queries[0].type).toBe('osc-bg');

      const resultCursor = parseTerminalQueries(`${ESC}]12;?${BEL}`);
      expect(resultCursor.queries[0].type).toBe('osc-cursor');
    });
  });
});
