/**
 * useVimMode smoke test - Basic integration scenarios.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { createRoot, createSignal, createEffect } from 'solid-js';
import { useVimMode } from '../useVimMode';

// Track config changes
let mockVimMode = 'overlays';
let mockTimeoutMs = 500;

vi.mock('../../../../contexts/ConfigContext', () => ({
  useConfig: () => ({
    config: () => ({
      keyboard: {
        vimMode: mockVimMode,
        vimSequenceTimeoutMs: mockTimeoutMs,
      },
    }),
  }),
}));

describe('useVimMode smoke', () => {
  beforeEach(() => {
    mockVimMode = 'overlays';
    mockTimeoutMs = 500;
    vi.clearAllMocks();
  });

  it('should update isEnabled when config changes', () => {
    createRoot((dispose) => {
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      expect(vim.isEnabled()).toBe(true);

      // Change config to disable vim mode
      mockVimMode = 'disabled';
      // Trigger reactivity by accessing again
      expect(vim.isEnabled()).toBe(false);

      dispose();
    });
  });

  it('should reset handlers when visibility changes', () => {
    createRoot((dispose) => {
      const [isVisible, setIsVisible] = createSignal(false);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      let resetCount = 0;
      createEffect(() => {
        // Track handler access
        const handlers = vim.getHandlers();
        if (isVisible()) {
          resetCount++;
        }
      });

      // Initial (not visible)
      expect(resetCount).toBe(0);

      // Make visible - should trigger reset
      setIsVisible(true);
      expect(vim.mode()).toBe('normal');

      dispose();
    });
  });

  it('should handle sequence timeouts from config', () => {
    createRoot((dispose) => {
      mockTimeoutMs = 1000;
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      const handlers = vim.getHandlers();
      expect(handlers.list).toBeDefined();

      dispose();
    });
  });

  it('should cleanup on dispose', () => {
    createRoot((dispose) => {
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      const handlers = vim.getHandlers();
      const listResetSpy = vi.spyOn(handlers.list, 'reset');

      dispose();

      // Cleanup should have been called
      expect(listResetSpy).toHaveBeenCalled();
    });
  });
});
