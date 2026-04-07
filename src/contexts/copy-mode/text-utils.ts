import type { TerminalCell } from '../../core/types';

export type LineAccessor = {
  maxAbsY: number;
  getLine: (absY: number) => TerminalCell[] | null;
};

/** Create a line accessor from a getLine function and max Y bound */
export const getLineAccessor = (
  maxAbsY: number,
  getLine: (absY: number) => TerminalCell[] | null
): LineAccessor => ({
  maxAbsY,
  getLine,
});

export type SpanResult = {
  absY: number;
  start: number;
  end: number;
  line: TerminalCell[];
};

export type RunResult = SpanResult & {
  kind: 'word' | 'punct';
};

export const isWordChar = (char: string): boolean => {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return /[A-Za-z0-9_]/.test(char) || code > 127;
};

export const isWhitespaceChar = (char: string): boolean => {
  return !char || char.trim().length === 0;
};

export const isWideWordChar = (char: string): boolean => {
  if (!char) return false;
  return !isWhitespaceChar(char);
};

const isPunctChar = (char: string): boolean => {
  return !isWhitespaceChar(char) && !isWordChar(char);
};

export const getRunAt = (access: LineAccessor, absY: number, x: number): RunResult | null => {
  const line = access.getLine(absY) ?? [];
  const limit = line.length;
  if (limit === 0) return null;
  if (x < 0 || x >= limit) return null;
  const char = line[x]?.char ?? ' ';
  if (isWhitespaceChar(char)) return null;
  const kind: RunResult['kind'] = isWordChar(char) ? 'word' : 'punct';
  const predicate = kind === 'word' ? isWordChar : isPunctChar;
  let start = x;
  let end = x;
  while (start > 0 && predicate(line[start - 1]?.char ?? ' ')) start -= 1;
  while (end < limit - 1 && predicate(line[end + 1]?.char ?? ' ')) end += 1;
  return { absY, start, end, line, kind };
};

export const findNextRun = (
  access: LineAccessor,
  absY: number,
  startX: number
): RunResult | null => {
  for (let y = absY; y <= access.maxAbsY; y += 1) {
    const line = access.getLine(y) ?? [];
    const limit = line.length;
    if (limit === 0) continue;
    let x = y === absY ? startX : 0;
    if (x < 0) x = 0;
    if (x >= limit) continue;
    for (; x < limit; x += 1) {
      const char = line[x]?.char ?? ' ';
      if (!isWhitespaceChar(char)) {
        return getRunAt(access, y, x);
      }
    }
  }
  return null;
};

export const findPrevRun = (
  access: LineAccessor,
  absY: number,
  startX: number
): RunResult | null => {
  for (let y = absY; y >= 0; y -= 1) {
    const line = access.getLine(y) ?? [];
    const limit = line.length;
    if (limit === 0) continue;
    let x = y === absY ? startX : limit - 1;
    if (x >= limit) x = limit - 1;
    if (x < 0) continue;
    for (; x >= 0; x -= 1) {
      const char = line[x]?.char ?? ' ';
      if (!isWhitespaceChar(char)) {
        return getRunAt(access, y, x);
      }
    }
  }
  return null;
};

export const findSpanAtOrAfter = (
  access: LineAccessor,
  absY: number,
  startX: number,
  predicate: (char: string) => boolean
): SpanResult | null => {
  for (let y = absY; y <= access.maxAbsY; y += 1) {
    const line = access.getLine(y) ?? [];
    const limit = line.length;
    if (limit === 0) continue;
    let x = y === absY ? startX : 0;
    if (x < 0) x = 0;
    if (x >= limit) continue;
    for (; x < limit; x += 1) {
      const char = line[x]?.char ?? ' ';
      if (predicate(char)) {
        let start = x;
        let end = x;
        while (start > 0 && predicate(line[start - 1]?.char ?? ' ')) start -= 1;
        while (end < limit - 1 && predicate(line[end + 1]?.char ?? ' ')) end += 1;
        return { absY: y, start, end, line };
      }
    }
  }
  return null;
};

export const findSpanAtOrBefore = (
  access: LineAccessor,
  absY: number,
  startX: number,
  predicate: (char: string) => boolean
): SpanResult | null => {
  for (let y = absY; y >= 0; y -= 1) {
    const line = access.getLine(y) ?? [];
    const limit = line.length;
    if (limit === 0) continue;
    let x = y === absY ? startX : limit - 1;
    if (x >= limit) x = limit - 1;
    if (x < 0) continue;
    for (; x >= 0; x -= 1) {
      const char = line[x]?.char ?? ' ';
      if (predicate(char)) {
        let start = x;
        let end = x;
        while (start > 0 && predicate(line[start - 1]?.char ?? ' ')) start -= 1;
        while (end < limit - 1 && predicate(line[end + 1]?.char ?? ' ')) end += 1;
        return { absY: y, start, end, line };
      }
    }
  }
  return null;
};
