/**
 * End-to-end clipboard-over-SSH behavior.
 *
 * This suite is designed to run inside a clean Linux container (e.g. Docker)
 * that does NOT ship xclip/xsel/wl-clipboard. It verifies that openmux still
 * behaves correctly when the system clipboard is unavailable:
 *
 * - Paste data arriving via bracketed paste is not lost or crashed on.
 * - Copy falls back to OSC 52 so the text reaches the parent terminal.
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { PassThrough } from 'node:stream';
import {
  createPasteInterceptingStdin,
  type TtyProperties,
} from '../src/terminal/paste-intercepting-stdin';
import { createClipboard } from '../src/effect/services/Clipboard';
import type { AppServices } from '../src/effect/services';

describe('clipboard over ssh (e2e)', () => {
  beforeAll(async () => {
    const tools = ['xclip', 'xsel', 'wl-copy', 'wl-paste'];
    const found: string[] = [];
    for (const tool of tools) {
      const proc = Bun.spawn(['which', tool], { stderr: 'ignore' });
      const exitCode = await proc.exited;
      if (exitCode === 0) found.push(tool);
    }
    expect(found).toEqual([]);
  });

  it('production clipboard service fails when no tool is available', async () => {
    const clipboard = await createClipboard();
    const result = await clipboard.write('should fail');
    expect(result).toBeInstanceOf(Error);
  });

  it('paste falls back to stdin data without crashing', async () => {
    const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
    realStdin.setRawMode = () => true as any;

    const passthrough = createPasteInterceptingStdin(realStdin, {
      onPasteTriggered: async () => false,
    });

    const chunks: Buffer[] = [];
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

    realStdin.write(Buffer.from('\x1b[200~pasted from remote client\x1b[201~'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const output = Buffer.concat(chunks).toString();
    expect(output).toContain('\x1b[200~');
    expect(output).toContain('pasted from remote client');
    expect(output).toContain('\x1b[201~');
  });

  it('empty paste does not crash or emit empty markers', async () => {
    const realStdin = new PassThrough() as NodeJS.ReadStream & TtyProperties;
    realStdin.setRawMode = () => true as any;

    const passthrough = createPasteInterceptingStdin(realStdin, {
      onPasteTriggered: async () => false,
    });

    const chunks: Buffer[] = [];
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));

    realStdin.write(Buffer.from('\x1b[200~\x1b[201~'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(Buffer.concat(chunks).length).toBe(0);
  });

  it('copy falls back to osc 52 when system clipboard is unavailable', async () => {
    const productionClipboard = await createClipboard();
    const emitted: string[] = [];

    mock.module('../src/effect/bridge/services-instance', () => ({
      getClipboardService: () => productionClipboard,
      getPtyService: () => ({}) as AppServices['pty'],
      getSessionManager: () => ({}) as AppServices['sessionManager'],
      getTemplateStorage: () => ({}) as AppServices['templateStorage'],
      getKeyboardRouter: () => ({}) as AppServices['keyboardRouter'],
      hasServices: () => true,
    }));

    mock.module('../src/terminal/host-output', () => ({
      setHostSequenceWriter: () => {},
      hasHostSequenceWriter: () => true,
      writeHostSequence: (sequence: string) => {
        emitted.push(sequence);
        return true;
      },
    }));

    const { copyToClipboard } = await import('../src/effect/bridge/clipboard-bridge');
    const result = await copyToClipboard('copy over ssh');

    expect(result).toBe(true);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toStartWith('\x1b]52;c;');
    expect(emitted[0]).toEndWith('\x1b\\');
  });
});
