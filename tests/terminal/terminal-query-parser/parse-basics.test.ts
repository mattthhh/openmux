import { describe, test, expect } from 'bun:test';
import { parseTerminalQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import {
  ESC,
  DSR_CPR_QUERY,
  DA1_QUERY,
  XTVERSION_QUERY,
} from '../../../src/terminal/terminal-query-passthrough/constants';

describe('parseTerminalQueries', () => {
  describe('no queries', () => {
    test('returns text unchanged when no queries present', () => {
      const result = parseTerminalQueries('hello world');
      expect(result.textSegments).toEqual(['hello world']);
      expect(result.queries).toEqual([]);
    });

    test('handles empty string', () => {
      const result = parseTerminalQueries('');
      expect(result.textSegments).toEqual(['']);
      expect(result.queries).toEqual([]);
    });
  });

  describe('multiple queries in one string', () => {
    test('parses multiple CPR queries', () => {
      const data = `${DSR_CPR_QUERY}${DSR_CPR_QUERY}`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(2);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.queries[1].type).toBe('cpr');
    });

    test('parses different query types', () => {
      const data = `${DSR_CPR_QUERY}${DA1_QUERY}${XTVERSION_QUERY}`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(3);
      expect(result.queries[0].type).toBe('cpr');
      expect(result.queries[1].type).toBe('da1');
      expect(result.queries[2].type).toBe('xtversion');
    });

    test('parses queries with text between them', () => {
      const data = `hello${DSR_CPR_QUERY}world${DA1_QUERY}!`;
      const result = parseTerminalQueries(data);
      expect(result.queries).toHaveLength(2);
      expect(result.textSegments).toEqual(['hello', 'world', '!']);
    });
  });

  describe('index tracking', () => {
    test('tracks correct indices for CPR query', () => {
      const result = parseTerminalQueries(DSR_CPR_QUERY);
      expect(result.queries[0].startIndex).toBe(0);
      expect(result.queries[0].endIndex).toBe(DSR_CPR_QUERY.length);
    });

    test('tracks correct indices with prefix', () => {
      const prefix = 'hello';
      const result = parseTerminalQueries(`${prefix}${DSR_CPR_QUERY}`);
      expect(result.queries[0].startIndex).toBe(prefix.length);
      expect(result.queries[0].endIndex).toBe(prefix.length + DSR_CPR_QUERY.length);
    });
  });

  describe('edge cases', () => {
    test('handles incomplete escape sequence', () => {
      const result = parseTerminalQueries(`${ESC}[`);
      // Should pass through as text since it's not a complete query
      expect(result.queries).toHaveLength(0);
      expect(result.textSegments[0]).toContain(ESC);
    });

    test('handles query-like text that is not a query', () => {
      const result = parseTerminalQueries('text with 6n in it');
      // Should not match because ESC[ is not present
      expect(result.queries).toHaveLength(0);
      expect(result.textSegments).toEqual(['text with 6n in it']);
    });
  });
});
