/**
 * Tests for PTY session factory exit hooks.
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TerminalColors } from '../../../../src/terminal/terminal-colors';
import * as capabilitiesActual from '../../../../src/terminal/capabilities';
import { makeCols, makeRows } from '../../../../src/effect/types';
import { PtySpawnError } from '../../../../src/effect/errors';
import { ScrollbackArchiveManager } from '../../../../src/terminal/scrollback-archive';
import { mockGhostty, resetGhosttySymbols } from '../../../mocks/ghostty-ffi';

let spawnAsync: typeof import('../../../../native/zig-pty/ts/index').spawnAsync;

const mockCreateGhosttyVTEmulator = vi.fn();
const mockGhosttySymbols = new Proxy(
  {},
  {
    get: () => vi.fn(),
  }
);

let createSession: typeof import('../../../../src/effect/services/pty/session-factory').createSession;

vi.mock('../../../../native/zig-pty/ts/index', () => ({
  spawnAsync: vi.fn(),
  watchSystemAppearance: vi.fn(() => null),
}));

vi.mock('../../../../src/terminal/ghostty-vt/emulator', () => ({
  createGhosttyVTEmulator: mockCreateGhosttyVTEmulator,
}));

vi.mock('../../../../src/terminal/capabilities', () => ({
  ...capabilitiesActual,
  getCapabilityEnvironment: vi.fn(() => ({})),
}));

describe('createSession', () => {
  beforeEach(async () => {
    ({ createSession } = await import('../../../../src/effect/services/pty/session-factory'));
    ({ spawnAsync } = await import('../../../../native/zig-pty/ts/index'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetGhosttySymbols();
    mockGhostty.symbols = mockGhosttySymbols;
  });

  it('notifies onExit hook when the PTY exits', async () => {
    let exitHandler: ((event: { exitCode: number }) => void) | null = null;

    const fakePty = {
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exitHandler = cb;
        return { dispose: () => {} };
      },
      onData: vi.fn(),
      onForegroundProcessChange: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      getCwd: vi.fn(() => '/'),
      getForegroundProcessName: vi.fn(),
      pid: 123,
      cols: 80,
      rows: 24,
      process: '/bin/sh',
      resizeWithPixels: vi.fn(),
      getForegroundPid: vi.fn(() => 123),
      getProcessName: vi.fn(() => 'sh'),
    } as unknown as Awaited<ReturnType<typeof spawnAsync>>;

    (spawnAsync as ReturnType<typeof vi.fn>).mockResolvedValue(fakePty);

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ''),
    };

    mockCreateGhosttyVTEmulator.mockReturnValue(emulator);

    const scrollbackArchiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-scrollback-'));

    const onExit = vi.fn();
    const result = await createSession(
      {
        colors: {} as TerminalColors,
        defaultShell: '/bin/sh',
        scrollbackArchiveManager: new ScrollbackArchiveManager(1024 * 1024),
        scrollbackArchiveRoot,
        onLifecycleEvent: vi.fn(),
        onTitleChange: vi.fn(),
        onExit,
      },
      { cols: makeCols(80), rows: makeRows(24) }
    );

    if (result instanceof PtySpawnError) {
      throw new Error('Failed to create session: ' + result.reason);
    }

    const { id, session } = result;
    const exitCallback = vi.fn();
    session.exitCallbacks.add(exitCallback);

    expect(exitHandler).not.toBeNull();
    exitHandler!({ exitCode: 0 });

    expect(exitCallback).toHaveBeenCalledWith(0);
    expect(onExit).toHaveBeenCalledWith(id, 0);
  });

  it('applies initial pixel sizing when provided', async () => {
    const resizeWithPixels = vi.fn();
    const fakePty = {
      onExit: vi.fn(() => ({ dispose: () => {} })),
      onData: vi.fn(),
      onForegroundProcessChange: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      resizeWithPixels,
      kill: vi.fn(),
      getCwd: vi.fn(() => '/'),
      getForegroundProcessName: vi.fn(),
      pid: 123,
      cols: 80,
      rows: 24,
      process: '/bin/sh',
      getForegroundPid: vi.fn(() => 123),
      getProcessName: vi.fn(() => 'sh'),
    } as unknown as Awaited<ReturnType<typeof spawnAsync>>;

    (spawnAsync as ReturnType<typeof vi.fn>).mockResolvedValue(fakePty);

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ''),
    };

    mockCreateGhosttyVTEmulator.mockReturnValue(emulator);

    const scrollbackArchiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-scrollback-'));

    const result = await createSession(
      {
        colors: {} as TerminalColors,
        defaultShell: '/bin/sh',
        scrollbackArchiveManager: new ScrollbackArchiveManager(1024 * 1024),
        scrollbackArchiveRoot,
        onLifecycleEvent: vi.fn(),
        onTitleChange: vi.fn(),
      },
      {
        cols: makeCols(80),
        rows: makeRows(24),
        pixelWidth: 800,
        pixelHeight: 480,
      }
    );

    if (result instanceof PtySpawnError) {
      throw new Error('Failed to create session: ' + result.reason);
    }

    const { session } = result;

    expect(resizeWithPixels).toHaveBeenCalledWith(80, 24, 800, 480);
    expect(session.pixelWidth).toBe(800);
    expect(session.pixelHeight).toBe(480);
    expect(session.cellWidth).toBe(10);
    expect(session.cellHeight).toBe(20);
  });

  it('updates the cached cwd when shell integration reports a new directory', async () => {
    let dataHandler: ((data: string) => void) | null = null;

    const fakePty = {
      onExit: vi.fn(() => ({ dispose: () => {} })),
      onData: vi.fn((cb: (data: string) => void) => {
        dataHandler = cb;
      }),
      onForegroundProcessChange: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      resizeWithPixels: vi.fn(),
      kill: vi.fn(),
      getCwd: vi.fn(() => '/initial'),
      getForegroundProcessName: vi.fn(),
      pid: 123,
      cols: 80,
      rows: 24,
      process: '/bin/zsh',
      getForegroundPid: vi.fn(() => 123),
      getProcessName: vi.fn(() => 'zsh'),
    } as unknown as Awaited<ReturnType<typeof spawnAsync>>;

    (spawnAsync as ReturnType<typeof vi.fn>).mockResolvedValue(fakePty);

    const emulator = {
      setUpdateEnabled: vi.fn(),
      onTitleChange: vi.fn(),
      onUpdate: vi.fn(),
      onModeChange: vi.fn(),
      getMode: vi.fn(() => false),
      write: vi.fn(),
      resize: vi.fn(),
      getTerminalState: vi.fn(),
      dispose: vi.fn(),
      getTitle: vi.fn(() => ''),
    };

    mockCreateGhosttyVTEmulator.mockReturnValue(emulator);

    const scrollbackArchiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-scrollback-'));

    const result = await createSession(
      {
        colors: {} as TerminalColors,
        defaultShell: '/bin/zsh',
        scrollbackArchiveManager: new ScrollbackArchiveManager(1024 * 1024),
        scrollbackArchiveRoot,
        onLifecycleEvent: vi.fn(),
        onTitleChange: vi.fn(),
        onActivity: vi.fn(),
      },
      { cols: makeCols(80), rows: makeRows(24), cwd: '/initial' }
    );

    if (result instanceof PtySpawnError) {
      throw new Error('Failed to create session: ' + result.reason);
    }

    const { session } = result;

    expect(dataHandler).not.toBeNull();
    dataHandler!('\x1b]777;openmux;cwd=%2Ftmp%2Freported\x07');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.cwd).toBe('/tmp/reported');
    expect(session.cwdReported).toBe(true);
  });
});
