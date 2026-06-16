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
      Object.assign(realStdin, { fd: 0 });

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => true,
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
        onPasteTriggered: () => true,
      });

      expect(passthrough.isTTY).toBe(false);
    });

    it('should not expose setRawMode for non-tty stdin streams', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      realStdin.isTTY = false;

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => true,
      });

      expect(passthrough.setRawMode).toBeUndefined();
    });

    it('should handle undefined setRawMode gracefully', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      // No setRawMode defined
      realStdin.isTTY = true;
      Object.assign(realStdin, { fd: 0 });

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => true,
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
          return true;
        },
      });

      // Write a complete paste sequence (start + content + end)
      realStdin.write(Buffer.from('\x1b[200~hello\x1b[201~'));

      expect(pasteTriggered).toBe(true);
    });

    it('should swallow paste data when clipboard succeeds', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      const chunks: Buffer[] = [];

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => true,
      });

      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Write paste start + content + end
      realStdin.write(Buffer.from('\x1b[200~swallowed data\x1b[201~'));

      // Clipboard succeeded — paste data should be swallowed
      expect(chunks.length).toBe(0);
    });

    it('should fall back to stdin data when clipboard fails', () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      const chunks: Buffer[] = [];

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => false,
      });

      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Write paste start + content + end
      realStdin.write(Buffer.from('\x1b[200~pasted text\x1b[201~'));

      // Clipboard failed — stdin data should be passed through
      const combined = Buffer.concat(chunks);
      expect(combined.toString()).toContain('pasted text');
      expect(combined.toString()).toContain('\x1b[200~');
      expect(combined.toString()).toContain('\x1b[201~');
    });

    it('should fall back to stdin data on async clipboard failure', async () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      const chunks: Buffer[] = [];

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => Promise.resolve(false),
      });

      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Write paste start + content + end
      realStdin.write(Buffer.from('\x1b[200~async paste\x1b[201~'));

      // Wait for the async handler to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      const combined = Buffer.concat(chunks);
      expect(combined.toString()).toContain('async paste');
    });

    it('should not emit empty markers when clipboard fails on an empty paste', async () => {
      const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
      realStdin.setRawMode = () => true;
      const chunks: Buffer[] = [];

      const passthrough = createPasteInterceptingStdin(realStdin, {
        onPasteTriggered: () => Promise.resolve(false),
      });

      passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

      // Paste markers with no content between them
      realStdin.write(Buffer.from('\x1b[200~\x1b[201~'));

      // Wait for the async handler to resolve
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(Buffer.concat(chunks).length).toBe(0);
    });
  });
});
