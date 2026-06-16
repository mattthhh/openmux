/**
 * Paste handler tests
 * Covers copy mode exit on bracketed paste
 */

import { describe, it, expect, mock } from 'bun:test';
import { createPasteHandler } from '../paste-handler';

describe('createPasteHandler', () => {
  it('writes pasted content to focused PTY', () => {
    const writeToPTY = mock(() => {});
    const handler = createPasteHandler({
      getFocusedPtyId: () => 'pty-1',
      writeToPTY,
    });

    handler.handleBracketedPaste({
      bytes: new Uint8Array([104, 101, 108, 108, 111]), // "hello"
      type: 'paste',
    } as any);

    expect(writeToPTY).toHaveBeenCalledTimes(1);
    expect(writeToPTY.mock.calls[0][0]).toBe('pty-1');
  });

  it('does not write when no focused PTY', () => {
    const writeToPTY = mock(() => {});
    const handler = createPasteHandler({
      getFocusedPtyId: () => undefined,
      writeToPTY,
    });

    handler.handleBracketedPaste({
      bytes: new Uint8Array([104, 101, 108, 108, 111]),
      type: 'paste',
    } as any);

    expect(writeToPTY).not.toHaveBeenCalled();
  });

  it('exits copy mode before pasting when exitCopyMode is provided', () => {
    const callOrder: string[] = [];
    const exitCopyMode = mock(() => {
      callOrder.push('exit');
    });
    const writeToPTY = mock(() => {
      callOrder.push('write');
    });
    const handler = createPasteHandler({
      getFocusedPtyId: () => 'pty-1',
      exitCopyMode,
      writeToPTY,
    });

    handler.handleBracketedPaste({
      bytes: new Uint8Array([104, 101, 108, 108, 111]),
      type: 'paste',
    } as any);

    expect(exitCopyMode).toHaveBeenCalledTimes(1);
    expect(writeToPTY).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['exit', 'write']);
  });

  it('works without exitCopyMode callback', () => {
    const writeToPTY = mock(() => {});
    const handler = createPasteHandler({
      getFocusedPtyId: () => 'pty-1',
      writeToPTY,
    });

    handler.handleBracketedPaste({
      bytes: new Uint8Array([104, 101, 108, 108, 111]),
      type: 'paste',
    } as any);

    expect(writeToPTY).toHaveBeenCalledTimes(1);
  });

  it('does not write empty paste events to PTY', () => {
    const writeToPTY = mock(() => {});
    const handler = createPasteHandler({
      getFocusedPtyId: () => 'pty-1',
      writeToPTY,
    });

    handler.handleBracketedPaste({
      bytes: new Uint8Array(),
      type: 'paste',
    } as any);

    expect(writeToPTY).not.toHaveBeenCalled();
  });
});
