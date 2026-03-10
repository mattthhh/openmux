/**
 * useVimMode litmus test - Quick validation of core functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useVimMode } from '../useVimMode';

// Mock config context
vi.mock('../../../../contexts/ConfigContext', () => ({
  useConfig: () => ({
    config: () => ({
      keyboard: {
        vimMode: 'overlays',
        vimSequenceTimeoutMs: 500,
      },
    }),
  }),
}));

describe('useVimMode litmus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with normal mode when vim enabled', () => {
    createRoot((dispose) => {
      const [isVisible, setIsVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      expect(vim.mode()).toBe('normal');
      expect(vim.isEnabled()).toBe(true);

      dispose();
    });
  });

  it('should provide handlers for all modes', () => {
    createRoot((dispose) => {
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      const handlers = vim.getHandlers();
      expect(handlers.list).toBeDefined();
      expect(handlers.preview).toBeDefined();
      expect(handlers.search).toBeDefined();

      // Handlers should have required methods
      expect(typeof handlers.list.handleCombo).toBe('function');
      expect(typeof handlers.list.reset).toBe('function');
      expect(typeof handlers.preview.handleCombo).toBe('function');
      expect(typeof handlers.search.handleCombo).toBe('function');

      dispose();
    });
  });

  it('should reset all handlers when reset called', () => {
    createRoot((dispose) => {
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      const handlers = vim.getHandlers();
      const listResetSpy = vi.spyOn(handlers.list, 'reset');
      const previewResetSpy = vi.spyOn(handlers.preview, 'reset');
      const searchResetSpy = vi.spyOn(handlers.search, 'reset');

      vim.resetHandlers();

      expect(listResetSpy).toHaveBeenCalled();
      expect(previewResetSpy).toHaveBeenCalled();
      expect(searchResetSpy).toHaveBeenCalled();

      dispose();
    });
  });

  it('should set mode when setMode called', () => {
    createRoot((dispose) => {
      const [isVisible] = createSignal(true);
      const vim = useVimMode({ isAggregateVisible: isVisible });

      expect(vim.mode()).toBe('normal');

      vim.setMode('insert');
      expect(vim.mode()).toBe('insert');

      vim.setMode('normal');
      expect(vim.mode()).toBe('normal');

      dispose();
    });
  });
});
