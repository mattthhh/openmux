import { describe, it, expect, mock, beforeEach } from 'bun:test';

describe('clipboard-bridge', () => {
  describe('copyToClipboard', () => {
    let writtenSequences: string[] = [];

    beforeEach(() => {
      writtenSequences = [];
    });

    it('falls back to osc 52 when system clipboard has no tool', async () => {
      const { ClipboardError } = await import('../../../src/effect/errors');

      mock.module('../../../src/effect/bridge/services-instance', () => ({
        getClipboardService: () => ({
          write: async () =>
            new ClipboardError({
              operation: 'write',
              reason:
                'No clipboard tool found. Install wl-clipboard (Wayland) or xclip/xsel (X11).',
            }),
          read: async () => '',
        }),
        getPtyService: () => ({}) as any,
        getSessionManager: () => ({}) as any,
        getTemplateStorage: () => ({}) as any,
        getKeyboardRouter: () => ({}) as any,
        hasServices: () => true,
      }));

      mock.module('../../../src/terminal/host-output', () => ({
        setHostSequenceWriter: () => {},
        hasHostSequenceWriter: () => true,
        writeHostSequence: (sequence: string) => {
          writtenSequences.push(sequence);
          return true;
        },
      }));

      const { copyToClipboard } = await import('../../../src/effect/bridge/clipboard-bridge');
      const result = await copyToClipboard('hello ssh');

      expect(result).toBe(true);
      expect(writtenSequences.length).toBe(1);
      expect(writtenSequences[0]).toStartWith('\x1b]52;c;');
      expect(writtenSequences[0]).toEndWith('\x1b\\');
    });

    it('uses system clipboard and skips osc 52 when write succeeds', async () => {
      mock.module('../../../src/effect/bridge/services-instance', () => ({
        getClipboardService: () => ({
          write: async () => undefined,
          read: async () => '',
        }),
        getPtyService: () => ({}) as any,
        getSessionManager: () => ({}) as any,
        getTemplateStorage: () => ({}) as any,
        getKeyboardRouter: () => ({}) as any,
        hasServices: () => true,
      }));

      mock.module('../../../src/terminal/host-output', () => ({
        setHostSequenceWriter: () => {},
        hasHostSequenceWriter: () => true,
        writeHostSequence: (sequence: string) => {
          writtenSequences.push(sequence);
          return true;
        },
      }));

      const { copyToClipboard } = await import('../../../src/effect/bridge/clipboard-bridge');
      const result = await copyToClipboard('hello local');

      expect(result).toBe(true);
      expect(writtenSequences.length).toBe(0);
    });

    it('does not copy empty strings', async () => {
      let serviceWriteCalled = false;

      mock.module('../../../src/effect/bridge/services-instance', () => ({
        getClipboardService: () => ({
          write: async () => {
            serviceWriteCalled = true;
            return undefined;
          },
          read: async () => '',
        }),
        getPtyService: () => ({}) as any,
        getSessionManager: () => ({}) as any,
        getTemplateStorage: () => ({}) as any,
        getKeyboardRouter: () => ({}) as any,
        hasServices: () => true,
      }));

      mock.module('../../../src/terminal/host-output', () => ({
        setHostSequenceWriter: () => {},
        hasHostSequenceWriter: () => true,
        writeHostSequence: (sequence: string) => {
          writtenSequences.push(sequence);
          return true;
        },
      }));

      const { copyToClipboard } = await import('../../../src/effect/bridge/clipboard-bridge');
      const result = await copyToClipboard('');

      expect(result).toBe(false);
      expect(serviceWriteCalled).toBe(false);
      expect(writtenSequences.length).toBe(0);
    });
  });
});
