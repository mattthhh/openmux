/**
 * useSessionDrag litmus test - Quick validation of core functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'solid-js';
import { useSessionDrag } from '../useSessionDrag';
import type { OpenTUIMouseEvent } from '@opentui/core';

describe('useSessionDrag litmus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with no drag state', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();

      expect(drag.draggingId()).toBeNull();
      expect(drag.targetId()).toBeNull();
      expect(drag.didDrag()).toBe(false);
      expect(drag.suppressToggle()).toBe(false);

      dispose();
    });
  });

  it('should start drag with beginDrag', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();

      drag.beginDrag('session-1');

      expect(drag.draggingId()).toBe('session-1');
      expect(drag.targetId()).toBe('session-1'); // Initially targets self
      expect(drag.didDrag()).toBe(false);
      expect(drag.suppressToggle()).toBe(false);

      dispose();
    });
  });

  it('should update target during drag', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();
      const getItemAtMouse = vi.fn().mockReturnValue({
        node: { type: 'session', session: { id: 'session-2' } },
      });

      drag.beginDrag('session-1');

      const mockEvent = { y: 5 } as OpenTUIMouseEvent;
      drag.updateTarget(mockEvent, getItemAtMouse);

      expect(drag.targetId()).toBe('session-2');
      expect(drag.didDrag()).toBe(true); // Different target = drag occurred
      expect(drag.suppressToggle()).toBe(true);

      dispose();
    });
  });

  it('should commit drag and call reorder callback', async () => {
    createRoot(async (dispose) => {
      const drag = useSessionDrag();
      const reorderCallback = vi.fn().mockResolvedValue(undefined);
      const getItemAtMouse = vi.fn().mockReturnValue({
        node: { type: 'session', session: { id: 'session-2' } },
      });

      drag.beginDrag('session-1');

      const mockEvent = { y: 5 } as OpenTUIMouseEvent;
      drag.updateTarget(mockEvent, getItemAtMouse);

      await drag.commitDrag(reorderCallback);

      expect(reorderCallback).toHaveBeenCalledWith('session-1', 'session-2');
      expect(drag.draggingId()).toBeNull(); // State cleared

      dispose();
    });
  });

  it('should not reorder if no drag occurred', async () => {
    createRoot(async (dispose) => {
      const drag = useSessionDrag();
      const reorderCallback = vi.fn();

      drag.beginDrag('session-1');
      // Don't update target (no drag)

      await drag.commitDrag(reorderCallback);

      expect(reorderCallback).not.toHaveBeenCalled();
      expect(drag.draggingId()).toBeNull();

      dispose();
    });
  });

  it('should cancel drag without calling reorder', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();

      drag.beginDrag('session-1');

      const getItemAtMouse = vi.fn().mockReturnValue({
        node: { type: 'session', session: { id: 'session-2' } },
      });
      const mockEvent = { y: 5 } as OpenTUIMouseEvent;
      drag.updateTarget(mockEvent, getItemAtMouse);

      drag.cancelDrag();

      expect(drag.draggingId()).toBeNull();
      expect(drag.targetId()).toBeNull();
      expect(drag.didDrag()).toBe(false);
      expect(drag.suppressToggle()).toBe(false);

      dispose();
    });
  });

  it('should extract session ID from PTY items', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();
      const getItemAtMouse = vi.fn().mockReturnValue({
        node: {
          type: 'pty',
          ptyInfo: { sessionId: 'session-3' },
        },
      });

      drag.beginDrag('session-1');

      const mockEvent = { y: 5 } as OpenTUIMouseEvent;
      drag.updateTarget(mockEvent, getItemAtMouse);

      expect(drag.targetId()).toBe('session-3');

      dispose();
    });
  });

  it('should extract session ID from placeholder items', () => {
    createRoot((dispose) => {
      const drag = useSessionDrag();
      const getItemAtMouse = vi.fn().mockReturnValue({
        node: {
          type: 'placeholder',
          parentSessionId: 'session-4',
        },
      });

      drag.beginDrag('session-1');

      const mockEvent = { y: 5 } as OpenTUIMouseEvent;
      drag.updateTarget(mockEvent, getItemAtMouse);

      expect(drag.targetId()).toBe('session-4');

      dispose();
    });
  });
});
