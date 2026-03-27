/**
 * zig-pty: Pure Zig PTY implementation for Bun
 *
 * A minimal, high-performance pseudoterminal library.
 *
 * Module structure:
 * - types.ts: Type definitions and constants
 * - event-emitter.ts: Simple event emitter
 * - lib-loader.ts: FFI library loading
 * - terminal.ts: Terminal class
 */

import { ptr } from 'bun:ffi';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { lib } from './lib-loader';
import { Terminal } from './terminal';
import type { IPty, IPtyForkOptions } from './types';
import { DEFAULT_COLS, DEFAULT_ROWS, SPAWN_PENDING, SPAWN_ERROR } from './types';

// Re-export types
export type {
  IDisposable,
  IPtyForkOptions,
  IExitEvent,
  IPty,
  TerminalOptions,
  ExitEvent,
} from './types';

// Re-export Terminal class
export { Terminal };

/**
 * Spawn a PTY synchronously
 */
export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty {
  return new Terminal(file, args, options);
}

function shQuote(s: string): string {
  if (s.length === 0) return "''";
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Spawn a PTY asynchronously - the fork() happens off the main thread.
 * This prevents animation stutter when creating new panes.
 */
export function spawnAsync(file: string, args: string[], options: IPtyForkOptions): Promise<IPty> {
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const cwd = options.cwd ?? process.cwd();

  const cmdline = [file, ...args.map(shQuote)].join(' ');

  let envStr = '';
  if (options.env) {
    const envPairs = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);
    envStr = envPairs.join('\0') + '\0';
  }

  const requestId = lib.symbols.bun_pty_spawn_async(
    Buffer.from(`${cmdline}\0`, 'utf8'),
    Buffer.from(`${cwd}\0`, 'utf8'),
    Buffer.from(`${envStr}\0`, 'utf8'),
    cols,
    rows
  );

  if (requestId < 0) {
    return Promise.reject(new Error('PTY async spawn request failed'));
  }

  return new Promise((resolve, reject) => {
    const poll = () => {
      const result = lib.symbols.bun_pty_spawn_poll(requestId);

      if (result === SPAWN_PENDING) {
        // Still pending - poll again after a short delay
        // Use 5ms interval to reduce polling overhead while staying responsive
        setTimeout(poll, 5);
        return;
      }

      if (result === SPAWN_ERROR || result < 0) {
        reject(new Error('PTY spawn failed'));
        return;
      }

      // Success - result is the handle
      // Defer Terminal creation to next tick to avoid synchronous work burst
      setImmediate(() => {
        resolve(Terminal.fromHandle(result, cols, rows));
      });
    };

    // Start polling on next tick to avoid synchronous FFI call
    setImmediate(poll);
  });
}

const APPEARANCE_NOTIFICATIONS = [
  'AppleInterfaceThemeChangedNotification',
  'AppleInterfaceStyleChangedNotification',
];

const SIGNAL_NAME = 'SIGUSR2';
const SIGNAL_NUMBER =
  (os.constants.signals as Record<string, number | undefined>)[SIGNAL_NAME] ??
  (process.platform === 'darwin' ? 31 : 12);

type AppearanceWatcher = {
  callbacks: Set<() => void>;
  cleanup: () => void;
};

let sharedAppearanceWatcher: AppearanceWatcher | null = null;
let appearanceExitHookAttached = false;

/**
 * Reset the appearance watcher state. For testing only.
 * @internal
 */
export function __resetAppearanceWatcherForTest(): void {
  if (sharedAppearanceWatcher) {
    sharedAppearanceWatcher.cleanup();
    sharedAppearanceWatcher = null;
  }
  appearanceExitHookAttached = false;
}

function createAppearanceWatcher(onChange: () => void): (() => void) | null {
  const watchers: Array<{
    stream: fs.ReadStream;
    token: number;
    onData: () => void;
  }> = [];
  const signalTokens: number[] = [];
  let signalHandler: (() => void) | null = null;

  for (const name of APPEARANCE_NOTIFICATIONS) {
    const tokenBuf = Buffer.alloc(4);
    const nameBuf = Buffer.from(`${name}\0`, 'utf8');
    const signalToken = lib.symbols.bun_pty_notify_register_signal(nameBuf, SIGNAL_NUMBER);
    if (signalToken >= 0) {
      signalTokens.push(signalToken);
    }

    const fd = lib.symbols.bun_pty_notify_register(nameBuf, ptr(tokenBuf));
    if (fd >= 0) {
      const token = tokenBuf.readInt32LE(0);
      const stream = fs.createReadStream('', { fd, autoClose: true, highWaterMark: 4 });
      const onData = () => onChange();
      stream.on('data', onData);
      stream.on('error', () => {});
      watchers.push({ stream, token, onData });
    }
  }

  if (signalTokens.length > 0) {
    signalHandler = () => onChange();
    process.on(SIGNAL_NAME, signalHandler);
  }

  if (watchers.length === 0 && signalTokens.length === 0) {
    return null;
  }

  return () => {
    if (signalHandler) {
      process.off(SIGNAL_NAME, signalHandler);
      signalHandler = null;
    }
    for (const token of signalTokens) {
      try {
        lib.symbols.bun_pty_notify_cancel(token);
      } catch {
        // ignore
      }
    }
    for (const watcher of watchers) {
      watcher.stream.off('data', watcher.onData);
      watcher.stream.destroy();
      try {
        lib.symbols.bun_pty_notify_cancel(watcher.token);
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Subscribe to macOS appearance changes via notify(3).
 * Returns a cleanup function, or null if unsupported.
 */
export function watchSystemAppearance(onChange: () => void): (() => void) | null {
  if (process.platform !== 'darwin') return null;

  if (!sharedAppearanceWatcher) {
    const callbacks = new Set<() => void>();
    const notifySubscribers = () => {
      for (const callback of callbacks) {
        try {
          callback();
        } catch {
          // ignore
        }
      }
    };
    const cleanup = createAppearanceWatcher(notifySubscribers);
    if (!cleanup) return null;
    sharedAppearanceWatcher = { callbacks, cleanup };
    if (!appearanceExitHookAttached) {
      appearanceExitHookAttached = true;
      process.once('exit', () => {
        if (sharedAppearanceWatcher) {
          sharedAppearanceWatcher.cleanup();
          sharedAppearanceWatcher = null;
        }
      });
    }
  }

  const handler = () => onChange();
  sharedAppearanceWatcher.callbacks.add(handler);

  return () => {
    const watcher = sharedAppearanceWatcher;
    if (!watcher) return;
    watcher.callbacks.delete(handler);
    if (watcher.callbacks.size === 0) {
      watcher.cleanup();
      sharedAppearanceWatcher = null;
    }
  };
}
