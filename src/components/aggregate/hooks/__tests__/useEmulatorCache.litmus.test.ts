/**
 * useEmulatorCache litmus test - Quick validation of core functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { useEmulatorCache, EmulatorCacheError } from '../useEmulatorCache';

// Mock bridge
const mockGetEmulator = vi.fn();
vi.mock('../../../../effect/bridge', () => ({
  getEmulator: (ptyId: string) => mockGetEmulator(ptyId),
}));

describe('useEmulatorCache litmus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty cache', () => {
    createRoot((dispose) => {
      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      expect(cache.get('pty-1')).toBeUndefined();
      expect(cache.getCachedPtyIds()).toEqual([]);
      expect(cache.getEpoch()).toBe(0);

      dispose();
    });
  });

  it('should cache emulator after preload', async () => {
    createRoot(async (dispose) => {
      const mockEmulator = { id: 'emu-1' } as unknown as import('../../../../terminal/emulator-interface').ITerminalEmulator;
      mockGetEmulator.mockResolvedValue(mockEmulator);

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      const result = await cache.preload('pty-1');
      expect(result).toBeUndefined(); // Success returns void
      expect(cache.get('pty-1')).toBe(mockEmulator);

      dispose();
    });
  });

  it('should return error on failed preload', async () => {
    createRoot(async (dispose) => {
      mockGetEmulator.mockRejectedValue(new Error('Failed to get emulator'));

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      const result = await cache.preload('pty-1');
      expect(result).toBeInstanceOf(EmulatorCacheError);
      expect(cache.get('pty-1')).toBeUndefined();

      dispose();
    });
  });

  it('should track pending state during preload', async () => {
    createRoot(async (dispose) => {
      let resolveEmulator: (value: unknown) => void;
      const emulatorPromise = new Promise((resolve) => {
        resolveEmulator = resolve;
      });
      mockGetEmulator.mockReturnValue(emulatorPromise);

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      // Start preload but don't await
      const preloadPromise = cache.preload('pty-1');

      // Should be pending
      expect(cache.isPending('pty-1')).toBe(true);

      // Resolve the promise
      resolveEmulator!({ id: 'emu-1' });
      await preloadPromise;

      // Should no longer be pending
      expect(cache.isPending('pty-1')).toBe(false);

      dispose();
    });
  });

  it('should reset cache and increment epoch', () => {
    createRoot(async (dispose) => {
      mockGetEmulator.mockResolvedValue({ id: 'emu-1' });

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      await cache.preload('pty-1');
      expect(cache.get('pty-1')).toBeDefined();
      expect(cache.getEpoch()).toBe(0);

      cache.reset();

      expect(cache.get('pty-1')).toBeUndefined();
      expect(cache.getEpoch()).toBe(1);

      dispose();
    });
  });

  it('should skip preload if already cached', async () => {
    createRoot(async (dispose) => {
      const mockEmulator = { id: 'emu-1' };
      mockGetEmulator.mockResolvedValue(mockEmulator);

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      await cache.preload('pty-1');
      expect(mockGetEmulator).toHaveBeenCalledTimes(1);

      // Second preload should be skipped
      const result = await cache.preload('pty-1');
      expect(result).toBeUndefined();
      expect(mockGetEmulator).toHaveBeenCalledTimes(1); // No additional call

      dispose();
    });
  });

  it('should skip preload if already pending', async () => {
    createRoot(async (dispose) => {
      let resolveEmulator: (value: unknown) => void;
      const emulatorPromise = new Promise((resolve) => {
        resolveEmulator = resolve;
      });
      mockGetEmulator.mockReturnValue(emulatorPromise);

      const [isActive] = createSignal(true);
      const cache = useEmulatorCache({ isActive });

      // Start first preload
      const preload1 = cache.preload('pty-1');

      // Second preload should be skipped (returns void immediately)
      const result = await cache.preload('pty-1');
      expect(result).toBeUndefined();
      expect(mockGetEmulator).toHaveBeenCalledTimes(1);

      resolveEmulator!({ id: 'emu-1' });
      await preload1;

      dispose();
    });
  });
});
