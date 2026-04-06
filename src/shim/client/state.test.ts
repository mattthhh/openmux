import { beforeEach, describe, expect, it } from 'bun:test';

// Import the real module using a query parameter to bypass any mocks
// The query parameter forces Bun to treat this as a different module
const stateModule = await import('./state?real');

const {
  deletePtyState,
  getCachedPtyMetadata,
  handlePtyActivity,
  handlePtyKittyTransmit,
  handlePtyTitle,
  resetAllPtyState,
  setCachedPtyMetadata,
  setPtyState,
  subscribeKittyTransmit,
  subscribeUnified,
} = stateModule;

describe('shim/client/state', () => {
  beforeEach(() => {
    resetAllPtyState();
  });
  it('replays the cached full terminal snapshot to unified subscribers', () => {
    const ptyId = 'pty-unified-test';
    const updates: Array<{ cols: number; rows: number; title: string }> = [];

    setPtyState(ptyId, {
      terminalState: {
        cols: 80,
        rows: 24,
        cells: [],
        cursor: { x: 0, y: 0, visible: true },
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
      },
      cachedRows: [],
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 12,
        isAtBottom: true,
      },
      title: 'shell',
    });

    const unsubscribe = subscribeUnified(ptyId, (update) => {
      updates.push({
        cols: update.terminalUpdate.cols,
        rows: update.terminalUpdate.rows,
        title: 'shell',
      });
    });

    unsubscribe();
    deletePtyState(ptyId);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ cols: 80, rows: 24, title: 'shell' });
  });

  it('marks cached metadata stale on activity but preserves title updates', () => {
    const ptyId = 'pty-metadata-test';

    setCachedPtyMetadata(ptyId, {
      session: null,
      cwd: '/tmp',
      title: 'before',
    });

    handlePtyTitle(ptyId, 'after');
    handlePtyActivity(ptyId);

    expect(getCachedPtyMetadata(ptyId)).toEqual({
      value: {
        session: null,
        cwd: '/tmp',
        title: 'after',
      },
      fetchedAt: expect.any(Number),
      stale: true,
    });

    deletePtyState(ptyId);
  });

  it('buffers kitty transmits until a subscriber attaches', () => {
    const ptyId = 'pty-kitty-test';
    const events: string[] = [];

    handlePtyKittyTransmit(ptyId, 'seq-1');
    const unsubscribe = subscribeKittyTransmit((event) => {
      if (event.ptyId === ptyId) {
        events.push(event.sequence);
      }
    });

    unsubscribe();
    deletePtyState(ptyId);

    expect(events).toEqual(['seq-1']);
  });
});
