/**
 * PTY Service Shim Implementation - Litmus Tests
 */
import { afterEach, describe, it, expect, vi, mock } from 'bun:test';

describe('createShimPtyService (litmus)', () => {
  afterEach(() => {
    mock.restore();
  });

  it('should create a service with all required methods', async () => {
    mock.module('../../../shim/client', () => ({
      waitForShim: vi.fn().mockResolvedValue(undefined),
      getTitle: vi.fn().mockResolvedValue('test'),
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
    expect(service.subscribeUnified).toBeTypeOf('function');
    expect(service.listAll).toBeTypeOf('function');
    expect(service.dispose).toBeTypeOf('function');
    expect(service.subscribeToLifecycle).toBeTypeOf('function');
    expect(service.subscribeToAllTitleChanges).toBeTypeOf('function');
  });
});
