import { describe, expect, it } from 'bun:test';

import { encodeKeyForEmulator } from '../../src/terminal/key-encoder';

describe('encodeKeyForEmulator fallback encoding', () => {
  it('encodes printable input before an emulator is cached', () => {
    expect(
      encodeKeyForEmulator(
        {
          key: 'a',
          sequence: 'a',
          eventType: 'press',
        },
        null
      )
    ).toBe('a');
  });

  it('encodes special keys before an emulator is cached', () => {
    expect(
      encodeKeyForEmulator(
        {
          key: 'up',
          eventType: 'press',
        },
        null
      )
    ).toBe('\x1b[A');
  });
});
