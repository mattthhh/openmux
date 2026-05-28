import { afterEach, describe, expect, it, vi } from 'bun:test';
import { checkForUpdateLabel } from '../../src/core/update-checker';

const originalFetch = globalThis.fetch;

describe('checkForUpdateLabel', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENMUX_VERSION;
  });

  it('returns label when latest version is newer', async () => {
    process.env.OPENMUX_VERSION = '0.2.0';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.3.0' }),
    } as Response);

    await expect(checkForUpdateLabel()).resolves.toBe('[UPDATE!]');
  });

  it('returns null when current version is latest', async () => {
    process.env.OPENMUX_VERSION = '0.3.0';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.3.0' }),
    } as Response);

    await expect(checkForUpdateLabel()).resolves.toBeNull();
  });

  it('returns null when request fails', async () => {
    process.env.OPENMUX_VERSION = '0.3.0';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ version: '0.4.0' }),
    } as Response);

    await expect(checkForUpdateLabel()).resolves.toBeNull();
  });
});
