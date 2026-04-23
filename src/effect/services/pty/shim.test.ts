/**
 * PTY Service Shim Implementation - Litmus Tests
 */
import { afterEach, describe, it, expect, vi, mock } from 'bun:test';

describe('createShimPtyService (litmus)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mock.restore();
  });

  it('should create a service with the consolidated PTY API', async () => {
    mock.module('../../../shim/client', () => ({
      waitForShim: vi.fn().mockResolvedValue(undefined),
      getTitle: vi.fn().mockResolvedValue('test'),
      getPtyCwds: vi.fn().mockResolvedValue(new Map()),
      getPtyCwd: vi.fn().mockResolvedValue('/tmp'),
      emitPtyData: vi.fn(),
      onShimDetached: vi.fn(() => () => {}),
      shutdownShim: vi.fn(),
      handlePtyNotification: vi.fn(),
      getPtyState: vi.fn(),
      handlePtyTitle: vi.fn(),
      registerEmulatorFactory: vi.fn(),
      getKittyState: vi.fn(),
      setPtyState: vi.fn(),
    }));

    const { createShimPtyService } = await import('./index.ts?shim-litmus');
    const service = createShimPtyService();

    expect(service.create).toBeTypeOf('function');
    expect(service.write).toBeTypeOf('function');
    expect(service.resize).toBeTypeOf('function');
    expect(service.destroy).toBeTypeOf('function');
    expect(service.getCwd).toBeTypeOf('function');
    expect(service.subscribe).toBeTypeOf('function');
    expect(service.getEmulator).toBeTypeOf('function');
    expect(service.listAll).toBeTypeOf('function');
    expect(service.dispose).toBeTypeOf('function');
    expect(service.subscribeToLifecycle).toBeTypeOf('function');
    expect(service.subscribeToTitle).toBeTypeOf('function');
    expect(service.subscribeToCwdChange).toBeTypeOf('function');
  });

  it('batches concurrent cwd lookups into a single shim round trip', async () => {
    const getPtyCwds = vi.fn().mockResolvedValue(
      new Map([
        ['pty-a', '/cwd/a'],
        ['pty-b', '/cwd/b'],
      ])
    );
    const getPtyCwd = vi.fn().mockResolvedValue('/single');

    mock.module('../../../shim/client', () => ({
      waitForShim: vi.fn().mockResolvedValue(undefined),
      getPtyCwds,
      getPtyCwd,
    }));

    const { createShimPtyService } = await import('./index.ts?shim-cwd-batch');
    const service = createShimPtyService();

    const [cwdA, cwdB] = await Promise.all([
      service.getCwd('pty-a' as any),
      service.getCwd('pty-b' as any),
    ]);

    expect(cwdA).toBe('/cwd/a');
    expect(cwdB).toBe('/cwd/b');
    expect(getPtyCwds).toHaveBeenCalledTimes(1);
    expect(getPtyCwds).toHaveBeenCalledWith(['pty-a', 'pty-b']);
    expect(getPtyCwd).not.toHaveBeenCalled();
  });

  it('falls back to per-pty cwd lookups when the batch rpc is unavailable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getPtyCwds = vi.fn().mockRejectedValue(new Error('unknown method getPtyCwds'));
    const getPtyCwd = vi.fn(async (ptyId: string) => `/cwd/${ptyId}`);

    mock.module('../../../shim/client', () => ({
      waitForShim: vi.fn().mockResolvedValue(undefined),
      getPtyCwds,
      getPtyCwd,
    }));

    const { createShimPtyService } = await import('./index.ts?shim-cwd-fallback');
    const service = createShimPtyService();

    const [cwdA, cwdB] = await Promise.all([
      service.getCwd('pty-a' as any),
      service.getCwd('pty-b' as any),
    ]);

    expect(cwdA).toBe('/cwd/pty-a');
    expect(cwdB).toBe('/cwd/pty-b');
    expect(getPtyCwds).toHaveBeenCalledTimes(1);
    expect(getPtyCwd).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
