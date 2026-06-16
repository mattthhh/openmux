import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  writeToPtySync,
  registerPtyWrite,
  unregisterPtyWrite,
} from '../../../src/effect/bridge/pty-bridge';

describe('pty-bridge', () => {
  describe('writeToPtySync', () => {
    beforeEach(() => {
      unregisterPtyWrite('test-pty');
    });

    afterEach(() => {
      unregisterPtyWrite('test-pty');
    });

    it('writes non-empty data via registered sync writer', () => {
      const writer = mock(() => {});
      registerPtyWrite('test-pty', writer);

      writeToPtySync('test-pty', 'hello');

      expect(writer).toHaveBeenCalledTimes(1);
      expect(writer.mock.calls[0][0]).toBe('hello');
    });

    it('does not invoke the writer on empty data', () => {
      const writer = mock(() => {});
      registerPtyWrite('test-pty', writer);

      writeToPtySync('test-pty', '');

      expect(writer).not.toHaveBeenCalled();
    });
  });
});
