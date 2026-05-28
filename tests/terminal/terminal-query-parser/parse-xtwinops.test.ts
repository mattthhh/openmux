import { describe, test, expect } from 'bun:test';
import { parseTerminalQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import {
  CSI,
  ESC,
  XTWINOPS_14T,
  XTWINOPS_16T,
  XTWINOPS_18T,
} from '../../../src/terminal/terminal-query-passthrough/constants';

describe('parseTerminalQueries', () => {
  describe('XTWINOPS queries', () => {
    test('parses XTWINOPS 14t (window size pixels)', () => {
      const result = parseTerminalQueries(XTWINOPS_14T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(14);
    });

    test('parses XTWINOPS 16t (cell size)', () => {
      const result = parseTerminalQueries(XTWINOPS_16T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(16);
    });

    test('parses XTWINOPS 18t (text area)', () => {
      const result = parseTerminalQueries(XTWINOPS_18T);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(18);
    });

    test('parses XTWINOPS 14t with extra params', () => {
      const query = `${ESC}[14;2t`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(14);
    });

    test('parses XTWINOPS 16t using 8-bit CSI', () => {
      const query = `${CSI}16t`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops');
      expect(result.queries[0].winop).toBe(16);
    });
  });

  describe('XTWINOPS drop parser (filters non-query CSI...t sequences)', () => {
    test('filters CSI 8;rows;cols;t (resize command)', () => {
      const result = parseTerminalQueries(`${ESC}[8;51;181t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
      expect(result.textSegments).toEqual([]);
    });

    test('filters CSI 4;height;width;t (resize in pixels response format)', () => {
      const result = parseTerminalQueries(`${ESC}[4;800;1200t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('filters CSI 6;h;w;t (cell size response format)', () => {
      const result = parseTerminalQueries(`${ESC}[6;16;8t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('filters CSI 1t (deiconify window)', () => {
      const result = parseTerminalQueries(`${ESC}[1t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('does NOT filter XTWINOPS queries (14t, 16t, 18t)', () => {
      // These should be parsed as 'xtwinops' type, not 'xtwinops-drop'
      const result14 = parseTerminalQueries(XTWINOPS_14T);
      expect(result14.queries[0].type).toBe('xtwinops');

      const result16 = parseTerminalQueries(XTWINOPS_16T);
      expect(result16.queries[0].type).toBe('xtwinops');

      const result18 = parseTerminalQueries(XTWINOPS_18T);
      expect(result18.queries[0].type).toBe('xtwinops');
    });

    test('filters CSI with mixed params ending in t', () => {
      const result = parseTerminalQueries(`${ESC}[3;100;200t`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
    });

    test('preserves text around filtered sequences', () => {
      const result = parseTerminalQueries(`hello${ESC}[8;51;181tworld`);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtwinops-drop');
      expect(result.textSegments).toEqual(['hello', 'world']);
    });
  });
});
