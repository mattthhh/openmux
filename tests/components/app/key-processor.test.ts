/**
 * Tests for processNormalModeKey keyboard forwarding behavior.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';

let processNormalModeKey: typeof import('../../../src/components/app/key-processor').processNormalModeKey;
let encodeKeyForEmulator: typeof import('../../../src/terminal/key-encoder').encodeKeyForEmulator;

vi.mock('../../../src/terminal/key-encoder', () => ({
  encodeKeyForEmulator: vi.fn(),
}));

describe('processNormalModeKey', () => {
  const emulator = {} as object;
  const getFocusedEmulator = vi.fn(() => emulator);
  const writeToFocused = vi.fn();
  const clearAllSelections = vi.fn();

  beforeAll(async () => {
    ({ processNormalModeKey } = await import('../../../src/components/app/key-processor'));
    ({ encodeKeyForEmulator } = await import('../../../src/terminal/key-encoder'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('clears selections and writes on press', () => {
    (encodeKeyForEmulator as any).mockReturnValue('encoded');

    processNormalModeKey(
      { key: 'a', sequence: 'a', eventType: 'press' },
      { clearAllSelections, getFocusedEmulator, writeToFocused }
    );

    expect(clearAllSelections).toHaveBeenCalledTimes(1);
    expect(encodeKeyForEmulator).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'a', sequence: 'a', eventType: 'press' }),
      emulator
    );
    expect(writeToFocused).toHaveBeenCalledWith('encoded');
  });

  test('skips selection clear on release but still encodes', () => {
    (encodeKeyForEmulator as any).mockReturnValue('encoded');

    processNormalModeKey(
      { key: 'a', sequence: 'a', eventType: 'release' },
      { clearAllSelections, getFocusedEmulator, writeToFocused }
    );

    expect(clearAllSelections).not.toHaveBeenCalled();
    expect(encodeKeyForEmulator).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'a', sequence: 'a', eventType: 'release' }),
      emulator
    );
    expect(writeToFocused).toHaveBeenCalledWith('encoded');
  });
});
