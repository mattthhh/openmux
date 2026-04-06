/**
 * Tests for service lifecycle and disposal.
 */
import { describe, test, expect, vi } from 'bun:test';

describe('disposeServices', () => {
  test('should dispose services without error', async () => {
    const { createTestServices } = await import('../../src/effect/services');
    const { disposeServices } = await import('../../src/effect/services');
    const services = await createTestServices();

    // Should not throw
    expect(() => disposeServices(services)).not.toThrow();
  });

  test('should call pty.dispose', async () => {
    const { createTestServices } = await import('../../src/effect/services');
    const { disposeServices } = await import('../../src/effect/services');
    const services = await createTestServices();

    const disposeSpy = vi.spyOn(services.pty, 'dispose');

    disposeServices(services);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  test('should be idempotent', async () => {
    const { createTestServices } = await import('../../src/effect/services');
    const { disposeServices } = await import('../../src/effect/services');
    const services = await createTestServices();

    // Multiple disposes should not throw
    expect(() => {
      disposeServices(services);
      disposeServices(services);
      disposeServices(services);
    }).not.toThrow();
  });
});

describe('services singleton', () => {
  let servicesInstanceNonce = 0;

  test('disposeServicesSingleton should clear global services', async () => {
    const { createTestServices } = await import('../../src/effect/services');
    const { setServices, hasServices, disposeServicesSingleton } = await import(
      `../../src/effect/bridge/services-instance.ts?singleton=${servicesInstanceNonce++}`
    );

    const services = await createTestServices();
    setServices(services);

    expect(hasServices()).toBe(true);

    disposeServicesSingleton();

    expect(hasServices()).toBe(false);
  });

  test('disposeServicesSingleton should be safe when no services set', async () => {
    const { disposeServicesSingleton } = await import(
      `../../src/effect/bridge/services-instance.ts?singleton=${servicesInstanceNonce++}`
    );

    expect(() => disposeServicesSingleton()).not.toThrow();
  });
});

describe('initializeServices', () => {
  describe('PTY service mode types', () => {
    test('should accept app mode', async () => {
      const { initializeServices } = await import('../../src/effect/services');

      // Just verify the type is accepted - don't actually initialize
      const fn = () => initializeServices({ mode: 'app' });
      expect(fn).not.toThrow();
    });

    test('should accept shim mode', async () => {
      const { initializeServices } = await import('../../src/effect/services');

      const fn = () => initializeServices({ mode: 'shim' });
      expect(fn).not.toThrow();
    });

    test('should default to app mode when no options provided', async () => {
      const { initializeServices } = await import('../../src/effect/services');

      const fn = () => initializeServices();
      expect(fn).not.toThrow();
    });
  });
});
