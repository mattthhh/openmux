import { beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fsActual from 'node:fs';
import * as osActual from 'node:os';

type MockStream = {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

// Module-level state for mock coordination (replaces vi.hoisted pattern)
const streams: MockStream[] = [];
const processListeners = new Map<string, Set<(...args: unknown[]) => void>>();

const addListener = (event: string, handler: (...args: unknown[]) => void) => {
  const set = processListeners.get(event) ?? new Set();
  set.add(handler);
  processListeners.set(event, set);
};

const removeListener = (event: string, handler: (...args: unknown[]) => void) => {
  processListeners.get(event)?.delete(handler);
};

const processMock = {
  platform: 'darwin',
  cwd: vi.fn(() => '/tmp'),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    addListener(event, handler);
    return processMock;
  }),
  off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    removeListener(event, handler);
    return processMock;
  }),
  once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const wrapper = (...args: unknown[]) => {
      removeListener(event, wrapper);
      handler(...args);
    };
    addListener(event, wrapper);
    return processMock;
  }),
  emit: (event: string, ...args: unknown[]) => {
    const listeners = Array.from(processListeners.get(event) ?? []);
    for (const handler of listeners) {
      handler(...args);
    }
  },
};

const createReadStream = vi.fn((_path: string, _opts: unknown) => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const stream: MockStream = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return stream;
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
      return stream;
    }),
    destroy: vi.fn(),
    emit: (event: string, ...args: unknown[]) => {
      const listeners = Array.from(handlers.get(event) ?? []);
      for (const handler of listeners) {
        handler(...args);
      }
    },
  };

  streams.push(stream);
  return stream as unknown;
});

const registerFds: number[] = [];
const registerTokens: number[] = [];
const signalTokens: number[] = [];

const notifyRegister = vi.fn((_name: Buffer, outToken: Buffer) => {
  const fd = registerFds.shift() ?? -1;
  const token = registerTokens.shift() ?? -1;
  if (token >= 0) {
    outToken.writeInt32LE(token, 0);
  }
  return fd;
});

const notifyRegisterSignal = vi.fn(() => signalTokens.shift() ?? -1);
const notifyCancel = vi.fn();

const reset = () => {
  streams.length = 0;
  registerFds.length = 0;
  registerTokens.length = 0;
  signalTokens.length = 0;
  processListeners.clear();
  processMock.on.mockClear();
  processMock.off.mockClear();
  processMock.once.mockClear();
  processMock.cwd.mockClear();
  createReadStream.mockClear();
  notifyRegister.mockClear();
  notifyRegisterSignal.mockClear();
  notifyCancel.mockClear();
};

vi.mock('bun:ffi', () => ({
  ptr: (value: unknown) => value,
}));

vi.mock('node:fs', () => ({
  ...fsActual,
  default: { ...fsActual, createReadStream },
  createReadStream,
}));

vi.mock('node:os', () => {
  const constants = {
    ...osActual.constants,
    signals: { ...osActual.constants.signals, SIGUSR2: 12 },
  };
  return {
    ...osActual,
    constants,
    default: { ...osActual, constants },
  };
});

vi.mock('node:process', () => ({
  default: processMock,
}));

vi.mock('../../../native/zig-pty/ts/lib-loader', () => ({
  lib: {
    symbols: {
      bun_pty_notify_register: notifyRegister,
      bun_pty_notify_cancel: notifyCancel,
      bun_pty_notify_register_signal: notifyRegisterSignal,
    },
  },
}));

const loadWatchSystemAppearance = async () => {
  const mod = await import(`../../../native/zig-pty/ts/index?appearance=${Date.now()}`);
  return {
    watchSystemAppearance: mod.watchSystemAppearance,
    reset: mod.__resetAppearanceWatcherForTest,
  };
};

beforeEach(async () => {
  reset();
  const mod = await import(`../../../native/zig-pty/ts/index?reset=${Date.now()}`);
  mod.__resetAppearanceWatcherForTest?.();
});

describe('watchSystemAppearance', () => {
  it('shares watchers and fans out callbacks', async () => {
    registerFds.push(10, 11);
    registerTokens.push(101, 102);
    signalTokens.push(201, 202);

    const { watchSystemAppearance } = await loadWatchSystemAppearance();
    const first = vi.fn();
    const second = vi.fn();

    const stopFirst = watchSystemAppearance(first);
    const stopSecond = watchSystemAppearance(second);

    expect(stopFirst).toBeTypeOf('function');
    expect(stopSecond).toBeTypeOf('function');
    expect(notifyRegister).toHaveBeenCalledTimes(2);
    expect(notifyRegisterSignal).toHaveBeenCalledTimes(2);
    expect(createReadStream).toHaveBeenCalledTimes(2);
    expect(processMock.on).toHaveBeenCalledTimes(1);

    expect(streams.length).toBe(2);
    streams[0].emit('data', Buffer.from([0]));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    processMock.emit('SIGUSR2');

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);

    stopFirst?.();
    expect(notifyCancel).not.toHaveBeenCalled();

    stopSecond?.();
    expect(notifyCancel).toHaveBeenCalledTimes(4);
    expect(streams[0].destroy).toHaveBeenCalled();
    expect(streams[1].destroy).toHaveBeenCalled();
  });

  it('cleans up on exit and allows re-register', async () => {
    registerFds.push(10, 11, 12, 13);
    registerTokens.push(101, 102, 103, 104);
    signalTokens.push(201, 202, 203, 204);

    const { watchSystemAppearance } = await loadWatchSystemAppearance();
    const handler = vi.fn();

    const stop = watchSystemAppearance(handler);

    expect(stop).toBeTypeOf('function');
    expect(processMock.once).toHaveBeenCalledTimes(1);

    processMock.emit('exit');

    expect(notifyCancel).toHaveBeenCalledTimes(4);

    const handler2 = vi.fn();
    const stop2 = watchSystemAppearance(handler2);

    expect(stop2).toBeTypeOf('function');
    expect(notifyRegister).toHaveBeenCalledTimes(4);
    expect(notifyRegisterSignal).toHaveBeenCalledTimes(4);
    expect(processMock.once).toHaveBeenCalledTimes(1);

    stop?.();
    stop2?.();
  });
});
