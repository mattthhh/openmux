import { describe, test, expect } from 'bun:test';
import { parseTerminalQueries } from '../../../src/terminal/terminal-query-passthrough/parser';
import { BEL, DCS, ST } from '../../../src/terminal/terminal-query-passthrough/constants';

describe('parseTerminalQueries', () => {
  describe('XTGETTCAP query (DCS+q...ST)', () => {
    test('parses XTGETTCAP query with BEL terminator', () => {
      const query = `${DCS}+qTN${BEL}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN']);
    });

    test('parses XTGETTCAP query with ST terminator', () => {
      const query = `${DCS}+qTN${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN']);
    });

    test('parses XTGETTCAP query with multiple capabilities', () => {
      const query = `${DCS}+qTN;Co;RGB${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('xtgettcap');
      expect(result.queries[0].capabilities).toEqual(['TN', 'Co', 'RGB']);
    });
  });

  describe('DECRQSS query (DCS$q...ST)', () => {
    test('parses DECRQSS query for SGR (m)', () => {
      const query = `${DCS}$qm${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe('m');
    });

    test('parses DECRQSS query for DECSCUSR (space q)', () => {
      const query = `${DCS}$q q${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe(' q');
    });

    test('parses DECRQSS query for DECSTBM (r)', () => {
      const query = `${DCS}$qr${ST}`;
      const result = parseTerminalQueries(query);
      expect(result.queries).toHaveLength(1);
      expect(result.queries[0].type).toBe('decrqss');
      expect(result.queries[0].statusType).toBe('r');
    });
  });
});
