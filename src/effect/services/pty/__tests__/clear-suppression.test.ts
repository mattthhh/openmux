/**
 * Tests for clear sequence suppression in PTY data handler.
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { InternalPtySession } from '../types';
import type { ITerminalEmulator } from '../../../../terminal/emulator-interface';
import { createSyncModeParser } from '../../../../terminal/sync-mode-parser';
import {
  createDataHandler,
  normalizePiFullRedrawSegment,
  suppressClearScreenSequences,
} from '../data-handler';

function createMockSession() {
  const emulatorWrites: string[] = [];
  const ptyWrites: string[] = [];
  let scrollbackArchiveResetCount = 0;
  let scrollbackArchiverResetCount = 0;
  let scrollbackScheduleCount = 0;
  let scrollbackLength = 0;
  let scrollbackTailTrim = 0;
  let resetTailTrimCount = 0;

  const emulator = {
    cols: 80,
    rows: 24,
    isDisposed: false,
    write(data: string | Uint8Array) {
      emulatorWrites.push(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
      // Simulate scrollback growth from LFs in the data
      const lfCount = (typeof data === 'string' ? data : '').split('\n').length - 1;
      if (lfCount > 0) {
        scrollbackLength += lfCount;
      }
    },
    resize() {},
    reset() {},
    dispose() {},
    getScrollbackLength() {
      return Math.max(0, scrollbackLength - scrollbackTailTrim);
    },
    getScrollbackLine() {
      return null;
    },
    getDirtyUpdate() {
      return {} as never;
    },
    getTerminalState() {
      return {} as never;
    },
    getCursor() {
      return { x: 0, y: 0, visible: true };
    },
    getCursorKeyMode() {
      return 'normal' as const;
    },
    getKittyKeyboardFlags() {
      return 0;
    },
    isMouseTrackingEnabled() {
      return false;
    },
    isAlternateScreen() {
      return false;
    },
    getMode() {
      return false;
    },
    getColors() {
      return { foreground: 0, background: 0 } as never;
    },
    getTitle() {
      return '';
    },
    onTitleChange() {
      return () => {};
    },
    onUpdate() {
      return () => {};
    },
    onModeChange() {
      return () => {};
    },
    drainResponses() {
      return [];
    },
    search() {
      return Promise.resolve([] as never);
    },
    eraseScrollbackTail(lines: number) {
      scrollbackTailTrim += lines;
    },
    resetScrollbackTailTrim() {
      scrollbackTailTrim = 0;
      resetTailTrimCount += 1;
    },
  } satisfies Partial<ITerminalEmulator> as ITerminalEmulator;

  const session = {
    id: 'test-pty',
    pty: {
      write(data: string) {
        ptyWrites.push(data);
      },
      getForegroundProcessName() {
        return null;
      },
    },
    emulator,
    liveEmulator: emulator,
    scrollbackArchive: {
      reset() {
        scrollbackArchiveResetCount += 1;
      },
    },
    scrollbackArchiver: {
      reset() {
        scrollbackArchiverResetCount += 1;
      },
      schedule() {
        scrollbackScheduleCount += 1;
      },
    },
    queryPassthrough: {
      process(data: string) {
        return data;
      },
    },
    cols: 80,
    rows: 24,
    pixelWidth: 800,
    pixelHeight: 600,
    cellWidth: 10,
    cellHeight: 25,
    cwd: '/tmp',
    shell: 'bash',
    closing: false,
    unifiedSubscribers: new Set(),
    exitCallbacks: new Set(),
    titleSubscribers: new Set(),
    lastCommand: null,
    focusTrackingEnabled: false,
    focusState: false,
    focusTrackingOwnerProcess: null,
    pendingNotify: false,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 0,
      lastIsAtBottom: true,
    },
    lastResizeTime: 0,
  } as unknown as InternalPtySession;

  return {
    session,
    emulatorWrites,
    ptyWrites,
    getScrollbackArchiveResetCount: () => scrollbackArchiveResetCount,
    getScrollbackArchiverResetCount: () => scrollbackArchiverResetCount,
    getScrollbackScheduleCount: () => scrollbackScheduleCount,
    getScrollbackLength: () => scrollbackLength,
    getScrollbackTailTrim: () => scrollbackTailTrim,
    getResetTailTrimCount: () => resetTailTrimCount,
    setScrollbackLength: (n: number) => {
      scrollbackLength = n;
    },
  };
}

async function waitForDrain() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushFakeTimers() {
  vi.runAllTimers();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizePiFullRedrawSegment', () => {
  it('replaces CSI 2J + CSI 3J with CSI H + CSI J (non-scrolling clear)', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[Jhello');
  });

  it('preserves tall pi full redraw frames after non-scrolling clear', () => {
    const input = '\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4';
    expect(normalizePiFullRedrawSegment(input, 2)).toBe(
      '\x1b[H\x1b[Jline 1\r\nline 2\r\nline 3\r\nline 4'
    );
  });

  it('supports 1;1H and C1 variants', () => {
    const input = '\x9b2J\x9b1;1H\x9b3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe('\x1b[H\x1b[Jhello');
  });

  it('only rewrites the destructive prefix at the start of the segment', () => {
    const input = 'prefix\x1b[2J\x1b[H\x1b[3Jhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe(input);
  });

  it('preserves non-pi clear sequences', () => {
    const input = '\x1b[2J\x1b[Hhello';
    expect(normalizePiFullRedrawSegment(input, 10)).toBe(input);
  });
});

describe('suppressClearScreenSequences', () => {
  it('removes CSI 2 J', () => {
    const input = 'hello\x1b[2Jworld';
    expect(suppressClearScreenSequences(input)).toBe('helloworld');
  });

  it('removes C1 CSI 2 J', () => {
    const input = 'a\x9b2Jb';
    expect(suppressClearScreenSequences(input)).toBe('ab');
  });

  it('preserves other sequences', () => {
    const input = '\x1b[31mred\x1b[0m\x1b[2J';
    expect(suppressClearScreenSequences(input)).toBe('\x1b[31mred\x1b[0m');
  });

  it('handles empty string', () => {
    expect(suppressClearScreenSequences('')).toBe('');
  });
});

describe('createDataHandler pi redraw integration', () => {
  it('normalizes pi full redraws to cursor-home replacement after sync parsing', async () => {
    const {
      session,
      emulatorWrites,
      getScrollbackArchiveResetCount,
      getScrollbackArchiverResetCount,
    } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[Jhello']);
    expect(getScrollbackArchiveResetCount()).toBe(0);
    expect(getScrollbackArchiverResetCount()).toBe(0);
  });

  it('still schedules scrollback archiving for the normalized redraw', async () => {
    const { session, getScrollbackScheduleCount } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(getScrollbackScheduleCount()).toBe(1);
  });

  it('preserves tall full redraw frames without scrollback duplication', async () => {
    const { session, emulatorWrites } = createMockSession();
    session.rows = 2;
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jline 1\r\nline 2\r\nline 3\r\nline 4\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[Jline 1\r\nline 2\r\nline 3\r\nline 4']);
  });

  it('leaves normal synchronized output untouched', async () => {
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026hplain output\x1b[?2026l');
    await waitForDrain();

    expect(emulatorWrites).toEqual(['plain output']);
  });

  it('resets the sync timeout while a large synchronized frame is still streaming', async () => {
    vi.useFakeTimers();
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
      syncTimeoutMs: 100,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello');
    // Flush microtask drain
    await Promise.resolve();
    await Promise.resolve();
    handleData(' world');
    // Flush microtask drain
    await Promise.resolve();
    await Promise.resolve();
    // 0ms total on fake timers — sync timeout (100ms) has not fired
    expect(emulatorWrites).toEqual([]);

    handleData('\x1b[?2026l');
    // Flush microtask drain only — don't run all timers
    // (runAllTimers would fire the sync timeout out of order)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[Jhello world']);
  });

  it('gives pi full redraw sync frames a longer idle timeout before force-flushing', async () => {
    vi.useFakeTimers();
    const { session, emulatorWrites } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
      syncTimeoutMs: 100,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello');
    vi.advanceTimersByTime(200);
    await Promise.resolve();

    expect(emulatorWrites).toEqual([]);

    vi.advanceTimersByTime(550);
    await flushFakeTimers();

    expect(emulatorWrites).toEqual(['\x1b[H\x1b[Jhello']);
  });
});

describe('createDataHandler persistent scrollback tail trim', () => {
  it('resets tail trim before measuring pre-write scrollback on pi full redraw', async () => {
    const { session, getResetTailTrimCount } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    // The drain should have called resetScrollbackTailTrim before measuring
    expect(getResetTailTrimCount()).toBeGreaterThanOrEqual(1);
  });

  it('calls eraseScrollbackTail when scrollback grows after pi full redraw', async () => {
    const { session, getScrollbackTailTrim, setScrollbackLength } = createMockSession();

    // Override emulator.write to simulate scrollback growth after write.
    // In a real terminal, the VT state machine may push lines into
    // scrollback even with cursor-positioned frames.
    const originalWrite = session.emulator.write.bind(session.emulator);
    let writeCount = 0;
    (session.emulator as any).write = (data: string | Uint8Array) => {
      originalWrite(data);
      writeCount++;
      // Simulate that the first write (pi full redraw) pushed 2 lines
      // into scrollback that should be trimmed.
      if (writeCount === 1) {
        setScrollbackLength(2);
      }
    };

    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    expect(getScrollbackTailTrim()).toBe(2);
  });

  it('tail trim persists across subsequent writes (not reset by write)', async () => {
    const { session, getScrollbackTailTrim, setScrollbackLength } = createMockSession();

    // Override emulator.write to simulate scrollback growth on first write.
    const originalWrite = session.emulator.write.bind(session.emulator);
    let writeCount = 0;
    (session.emulator as any).write = (data: string | Uint8Array) => {
      originalWrite(data);
      writeCount++;
      if (writeCount === 1) {
        setScrollbackLength(3);
      }
    };

    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    const trimAfterRedraw = getScrollbackTailTrim();
    expect(trimAfterRedraw).toBe(3);

    // Now send normal (non-sync-mode) data — the tail trim should persist
    // because write() no longer resets scrollback_tail_trim.
    (session.emulator as any).write = originalWrite;
    handleData('more data\n');
    await waitForDrain();

    // The trim should NOT have been reset by the normal write
    expect(getScrollbackTailTrim()).toBe(trimAfterRedraw);
  });

  it('tail trim is reset when next pi full redraw starts', async () => {
    const { session, getScrollbackTailTrim, getResetTailTrimCount, setScrollbackLength } =
      createMockSession();

    // Override emulator.write to simulate scrollback growth on each pi redraw.
    const originalWrite = session.emulator.write.bind(session.emulator);
    let writeCount = 0;
    (session.emulator as any).write = (data: string | Uint8Array) => {
      originalWrite(data);
      writeCount++;
      // First and second pi redraw both simulate 2 lines of growth
      if (writeCount <= 2) {
        setScrollbackLength(writeCount * 2);
      }
    };

    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jhello\x1b[?2026l');
    await waitForDrain();

    const resetsAfterFirst = getResetTailTrimCount();

    // Send a second pi full redraw — the old tail trim should be reset
    // before measuring the new pre-write scrollback
    handleData('\x1b[?2026h\x1b[2J\x1b[H\x1b[3Jworld\x1b[?2026l');
    await waitForDrain();

    // Reset should have been called again for the second redraw
    expect(getResetTailTrimCount()).toBeGreaterThan(resetsAfterFirst);
  });

  it('does not trim scrollback for non-pi normal output', async () => {
    const { session, getScrollbackTailTrim } = createMockSession();
    const { handleData } = createDataHandler({
      copyToClipboard: async () => true,
      session,
      syncParser: createSyncModeParser(),
      getPriority: () => 'focused' as const,
    });

    handleData('just normal output\nwith newlines\n');
    await waitForDrain();

    // No pi full redraw — no tail trim should be applied
    expect(getScrollbackTailTrim()).toBe(0);
  });
});
