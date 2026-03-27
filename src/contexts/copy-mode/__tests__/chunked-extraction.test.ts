import { describe, expect, it } from 'bun:test';
import { extractBlockTextByChunks, extractRangeTextByChunks } from '../text';
import type { SelectionRange } from '../../../core/coordinates';

describe('chunked copy-mode extraction', () => {
  it('extracts large range selections across many fetched chunks', async () => {
    const range: SelectionRange = {
      startX: 0,
      startY: 0,
      endX: 6,
      endY: 1299,
      focusAtEnd: true,
    };

    const result = await extractRangeTextByChunks({
      range,
      scrollbackLength: 1300,
      fetchScrollbackLines: async (startOffset, count) => {
        const lines = new Map<number, Array<{ char: string; width: number }>>();
        for (let i = 0; i < count; i += 1) {
          const offset = startOffset + i;
          lines.set(
            offset,
            `line-${offset}`.split('').map((char) => ({ char, width: 1 }))
          );
        }
        return lines as Map<number, any>;
      },
      getLiveLine: () => null,
    });

    expect(result).not.toBeInstanceOf(Error);
    if (result instanceof Error) return;
    const lines = result.split('\n');
    expect(lines).toHaveLength(1300);
    expect(lines[0]).toBe('line-0');
    expect(lines[1299]).toBe('line-1');
  });

  it('extracts block selections across scrollback and live rows', async () => {
    const result = await extractBlockTextByChunks({
      anchor: { x: 1, absY: 510 },
      cursor: { x: 3, absY: 514 },
      scrollbackLength: 512,
      fetchScrollbackLines: async (startOffset, count) => {
        const lines = new Map<number, Array<{ char: string; width: number }>>();
        for (let i = 0; i < count; i += 1) {
          const offset = startOffset + i;
          lines.set(
            offset,
            `s${offset}`
              .padEnd(4, '.')
              .split('')
              .map((char) => ({ char, width: 1 }))
          );
        }
        return lines as Map<number, any>;
      },
      getLiveLine: (absY) =>
        `l${absY}`
          .padEnd(4, '.')
          .split('')
          .map((char) => ({ char, width: 1 })) as any,
    });

    expect(result).not.toBeInstanceOf(Error);
    if (result instanceof Error) return;
    expect(result.split('\n')).toEqual(['510', '511', '512', '513', '514']);
  });
});
