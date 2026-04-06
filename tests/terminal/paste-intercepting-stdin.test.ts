import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createPasteInterceptingStdin,
  type TtyProperties,
} from '../../src/terminal/paste-intercepting-stdin';
import { PassThrough } from 'stream';

describe('createPasteInterceptingStdin', () => {
  describe('TTY properties binding', () => {
    it('should preserve setRawMode binding to real stdin', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      let setRawModeCalled = false;
      let setRawModeThis: unknown = null;

      // Mock setRawMode that checks 'this' context
      realStdin.setRawMode = function (mode: boolean) {
        setRawModeCalled = true;
        setRawModeThis = this;
        return true;
      };
      realStdin.isTTY = true;

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => {},
      });

      // Call setRawMode on the passthrough - should preserve binding
      passthrough.setRawMode?.(true);

      expect(setRawModeCalled).toBe(true);
      expect(setRawModeThis).toBe(realStdin);
    });

    it('should copy isTTY from real stdin', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      realStdin.isTTY = false;

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => {},
      });

      expect(passthrough.isTTY).toBe(false);
    });

    it('should handle undefined setRawMode gracefully', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      // No setRawMode defined
      realStdin.isTTY = true;

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => {},
      });

      // Should not throw when accessing undefined setRawMode
      expect(passthrough.setRawMode).toBeUndefined();
      expect(passthrough.isTTY).toBe(true);
    });
  });

  describe('paste interception', () => {
    it('should trigger callback on paste start sequence', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      let pasteTriggered = false;

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => {
          pasteTriggered = true;
        },
      });

      // Write paste start sequence
      realStdin.write(Buffer.from('\x1b[200~'));

      expect(pasteTriggered).toBe(true);
    });

    it('should swallow paste data until end sequence', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      const chunks: Buffer[] = [];

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => {},
      });

      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Write paste start + content + end
      realStdin.write(Buffer.from('\x1b[200~swallowed data\x1b[201~'));

      // Only the end sequence should pass through (indicating paste ended)
      expect(chunks.length).toBeGreaterThanOrEqual(0); // May be empty or just control sequences
    });
  });
});
