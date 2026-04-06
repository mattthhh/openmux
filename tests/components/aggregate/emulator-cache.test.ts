import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { createRoot, createSignal } from 'solid-js';
import type { ITerminalEmulator } from '../../../src/terminal/emulator-interface';

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useEmulatorCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads the selected PTY emulator while aggregate view is active', async () => {
    const emulator = { isDisposed: false } as ITerminalEmulator;
    const loadEmulator = vi.fn().mockResolvedValue(emulator);

    const { useEmulatorCache } =
      await import('../../../src/components/aggregate/hooks/useEmulatorCache');

    const [selectedPtyId] = createSignal<string | null>('pty-other-session');
    let cached: ReturnType<typeof useEmulatorCache> | null = null;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      cached = useEmulatorCache({
        isActive: () => true,
        getSelectedPtyId: selectedPtyId,
        loadEmulator,
      });
    });

    await flush();

    expect(loadEmulator).toHaveBeenCalledWith('pty-other-session');
    expect(cached?.get('pty-other-session')).toBe(emulator);

    dispose();
  });

  it('does not preload while the aggregate view is inactive', async () => {
    const loadEmulator = vi.fn().mockResolvedValue(null);
    const { useEmulatorCache } =
      await import('../../../src/components/aggregate/hooks/useEmulatorCache');

    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      useEmulatorCache({
        isActive: () => false,
        getSelectedPtyId: () => 'pty-other-session',
        loadEmulator,
      });
    });

    await flush();

    expect(loadEmulator).not.toHaveBeenCalled();

    dispose();
  });
});
