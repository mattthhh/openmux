/**
 * Focused PTY Registry tests
 * Covers copy mode exit callback for bracketed paste
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  setFocusedPty,
  setClipboardPasteHandler,
  setCopyModeExitCallback,
  triggerClipboardPaste,
  getFocusedPtyId,
  observeFocusedPtyId,
  resetFocusedPtyRegistry,
} from '../focused-pty-registry';

describe('focused-pty-registry', () => {
  // Reset all state between tests
  beforeEach(() => {
    setFocusedPty(null);
    setClipboardPasteHandler(() => true);
    setCopyModeExitCallback(null);
  });

  describe('setFocusedPty / getFocusedPtyId', () => {
    it('tracks the focused PTY ID', () => {
      setFocusedPty('pty-1');
      expect(getFocusedPtyId()).toBe('pty-1');
    });

    it('clears the focused PTY ID with null', () => {
      setFocusedPty('pty-1');
      setFocusedPty(null);
      expect(getFocusedPtyId()).toBeNull();
    });
  });

  describe('observeFocusedPtyId', () => {
    // Note: bun:test resolves solid-js to its server build, where
    // createEffect is a no-op — the reactive re-run behavior can't be
    // exercised here. These tests verify the signal stays in lockstep
    // with the plain registry value.
    it('mirrors setFocusedPty', () => {
      expect(observeFocusedPtyId()).toBeNull();

      setFocusedPty('pty-1');
      expect(observeFocusedPtyId()).toBe('pty-1');
      expect(observeFocusedPtyId()).toBe(getFocusedPtyId());

      setFocusedPty(null);
      expect(observeFocusedPtyId()).toBeNull();
    });

    it('resets with resetFocusedPtyRegistry', () => {
      setFocusedPty('pty-1');
      resetFocusedPtyRegistry();
      expect(observeFocusedPtyId()).toBeNull();
      expect(getFocusedPtyId()).toBeNull();
    });
  });

  describe('triggerClipboardPaste', () => {
    it('returns false when no focused PTY', () => {
      const handler = mock(() => true as boolean);
      setClipboardPasteHandler(handler);
      expect(triggerClipboardPaste()).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns false when no handler set', () => {
      setFocusedPty('pty-1');
      setClipboardPasteHandler(null as any);
      expect(triggerClipboardPaste()).toBe(false);
    });

    it('calls clipboard handler with focused PTY ID', () => {
      setFocusedPty('pty-1');
      const handler = mock((_ptyId: string) => true as boolean);
      setClipboardPasteHandler(handler);
      expect(triggerClipboardPaste()).toBe(true);
      expect(handler).toHaveBeenCalledWith('pty-1');
    });
  });

  describe('copy mode exit callback', () => {
    it('does not call exit callback when not set', () => {
      setFocusedPty('pty-1');
      const exitCb = mock(() => {});
      const handler = mock(() => true as boolean);
      setClipboardPasteHandler(handler);
      // Don't set copyModeExitCallback
      triggerClipboardPaste();
      expect(exitCb).not.toHaveBeenCalled();
    });

    it('calls exit callback before clipboard handler', () => {
      setFocusedPty('pty-1');
      const callOrder: string[] = [];
      const exitCb = mock(() => {
        callOrder.push('exit');
      });
      const handler = mock(() => {
        callOrder.push('paste');
        return true as boolean;
      });
      setClipboardPasteHandler(handler);
      setCopyModeExitCallback(exitCb);

      triggerClipboardPaste();

      expect(exitCb).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['exit', 'paste']);
    });

    it('clears exit callback when set to null', () => {
      setFocusedPty('pty-1');
      const exitCb = mock(() => {});
      setCopyModeExitCallback(exitCb);
      setCopyModeExitCallback(null);

      const handler = mock(() => true as boolean);
      setClipboardPasteHandler(handler);

      triggerClipboardPaste();

      expect(exitCb).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
