import { describe, expect, it } from 'bun:test';
import {
  resolveKittyOffloadCleanupDelay,
  resolveKittyOffloadThreshold,
} from '../../src/terminal/kitty-graphics/offload-utils';

type EnvValues = Record<string, string | undefined>;

function withEnv(values: EnvValues, fn: () => void): void {
  const prior: EnvValues = {};
  for (const key of Object.keys(values)) {
    prior[key] = process.env[key];
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }

  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      const next = prior[key];
      if (next === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = next;
      }
    }
  }
}

describe('kitty offload utils', () => {
  it('defaults to the standard threshold when not on ssh', () => {
    withEnv(
      {
        OPENMUX_KITTY_OFFLOAD_THRESHOLD: undefined,
        SSH_CONNECTION: undefined,
        SSH_CLIENT: undefined,
        SSH_TTY: undefined,
      },
      () => {
        expect(resolveKittyOffloadThreshold()).toBe(512 * 1024);
      }
    );
  });

  it('disables offload automatically when ssh is detected', () => {
    withEnv(
      {
        OPENMUX_KITTY_OFFLOAD_THRESHOLD: undefined,
        SSH_CONNECTION: '1',
        SSH_CLIENT: undefined,
        SSH_TTY: undefined,
      },
      () => {
        expect(resolveKittyOffloadThreshold()).toBe(0);
      }
    );
  });

  it('respects explicit threshold values even on ssh', () => {
    withEnv(
      {
        OPENMUX_KITTY_OFFLOAD_THRESHOLD: '42',
        SSH_CONNECTION: '1',
        SSH_CLIENT: undefined,
        SSH_TTY: undefined,
      },
      () => {
        expect(resolveKittyOffloadThreshold()).toBe(42);
      }
    );
  });

  it('defaults cleanup delay when env is missing', () => {
    withEnv({ OPENMUX_KITTY_OFFLOAD_CLEANUP_MS: undefined }, () => {
      expect(resolveKittyOffloadCleanupDelay()).toBe(5000);
    });
  });

  it('accepts cleanup delay overrides', () => {
    withEnv({ OPENMUX_KITTY_OFFLOAD_CLEANUP_MS: '1234' }, () => {
      expect(resolveKittyOffloadCleanupDelay()).toBe(1234);
    });
  });
});
