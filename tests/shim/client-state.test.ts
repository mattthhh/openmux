import { describe, expect, test } from 'bun:test';
import type { TerminalCell, TerminalState, UnifiedTerminalUpdate } from '../../src/core/types';
import {
  deletePtyState,
  getEmulator,
  getKittyState,
  getPtyState,
  handlePtyActivity,
  handlePtyLifecycle,
  handlePtyKittyTransmit,
  handlePtyKittyUpdate,
  handlePtyTitle,
  handleUnifiedUpdate,
  registerEmulatorFactory,
  setPtyState,
  subscribeToActivity,
  subscribeKittyTransmit,
  subscribeScroll,
  subscribeState,
  subscribeToAllTitles,
  subscribeToLifecycle,
  subscribeToTitle,
  subscribeUnified,
} from '../../src/shim/client/state';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsPlacementTag,
} from '../../src/terminal/emulator-interface';

const baseCell: TerminalCell = {
  char: 'a',
  fg: { r: 0, g: 0, b: 0 },
  bg: { r: 0, g: 0, b: 0 },
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  blink: false,
  dim: false,
  width: 1,
};

function makeState(char: string): TerminalState {
  const cell = { ...baseCell, char };
  return {
    cols: 2,
    rows: 1,
    cells: [[cell, cell]],
    cursor: { x: 0, y: 0, visible: true },
    alternateScreen: false,
    mouseTracking: false,
  };
}

describe('shim client state', () => {
  test('applies full updates and notifies subscribers', () => {
    const ptyId = 'pty-full';
    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 1, y: 0, visible: true },
        scrollState: { viewportOffset: 0, scrollbackLength: 2, isAtBottom: true },
        cols: 2,
        rows: 1,
        isFull: true,
        fullState: makeState('x'),
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: { viewportOffset: 0, scrollbackLength: 2, isAtBottom: true },
    };

    let unifiedCount = 0;
    let stateCount = 0;
    let scrollCount = 0;
    const unsubUnified = subscribeUnified(ptyId, () => {
      unifiedCount += 1;
    });
    const unsubState = subscribeState(ptyId, () => {
      stateCount += 1;
    });
    const unsubScroll = subscribeScroll(ptyId, () => {
      scrollCount += 1;
    });

    handleUnifiedUpdate(ptyId, update);

    expect(unifiedCount).toBe(1);
    expect(stateCount).toBe(1);
    expect(scrollCount).toBe(1);
    expect(getPtyState(ptyId)?.terminalState?.cells[0]?.[0]?.char).toBe('x');

    unsubUnified();
    unsubState();
    unsubScroll();
    deletePtyState(ptyId);
  });

  test('applies dirty rows to cached state', () => {
    const ptyId = 'pty-dirty';
    const initialState = makeState('a');
    setPtyState(ptyId, {
      terminalState: initialState,
      cachedRows: [...initialState.cells],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: 'init',
    });

    const dirtyRow = [
      { ...baseCell, char: 'z' },
      { ...baseCell, char: 'y' },
    ];
    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map([[0, dirtyRow]]),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: { viewportOffset: 0, scrollbackLength: 1, isAtBottom: true },
        cols: 2,
        rows: 1,
        isFull: false,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: { viewportOffset: 0, scrollbackLength: 1, isAtBottom: true },
    };

    handleUnifiedUpdate(ptyId, update);
    const state = getPtyState(ptyId);
    expect(state?.terminalState?.cells[0]?.[0]?.char).toBe('z');
    expect(state?.title).toBe('init');

    deletePtyState(ptyId);
  });

  test('updates title and notifies title subscribers', () => {
    const ptyId = 'pty-title';
    let titleCount = 0;
    let globalCount = 0;
    const unsubTitle = subscribeToTitle(ptyId, () => {
      titleCount += 1;
    });
    const unsubGlobal = subscribeToAllTitles(() => {
      globalCount += 1;
    });

    handlePtyTitle(ptyId, 'hello');

    expect(titleCount).toBe(1);
    expect(globalCount).toBe(1);
    expect(getPtyState(ptyId)?.title).toBe('hello');

    unsubTitle();
    unsubGlobal();
    deletePtyState(ptyId);
  });

  test('notifies global activity subscribers', () => {
    const ptyId = 'pty-activity';
    let activityCount = 0;
    const unsubscribe = subscribeToActivity((event) => {
      expect(event.ptyId).toBe(ptyId);
      activityCount += 1;
    });

    handlePtyActivity(ptyId);

    expect(activityCount).toBe(1);

    unsubscribe();
  });

  test('lifecycle destroy removes cached state', () => {
    const ptyId = 'pty-life';
    setPtyState(ptyId, {
      terminalState: makeState('b'),
      cachedRows: [],
      scrollState: { viewportOffset: 0, scrollbackLength: 0, isAtBottom: true },
      title: '',
    });

    let eventType: 'created' | 'destroyed' | null = null;
    const unsub = subscribeToLifecycle((event) => {
      eventType = event.type;
    });

    handlePtyLifecycle(ptyId, 'destroyed');

    expect(eventType).toBe('destroyed');
    expect(getPtyState(ptyId)).toBeUndefined();

    unsub();
  });

  test('propagates scrollback changes to cached emulator', () => {
    const ptyId = 'pty-emulator';
    let lastScrollback: number | null = null;
    let lastLimit: boolean | null = null;
    registerEmulatorFactory(
      () =>
        ({
          handleScrollbackChange: (newLength: number, isAtLimit: boolean) => {
            lastScrollback = newLength;
            lastLimit = isAtLimit;
          },
        }) as any
    );

    getEmulator(ptyId);

    const update: UnifiedTerminalUpdate = {
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: {
          viewportOffset: 0,
          scrollbackLength: 3,
          isAtBottom: true,
          isAtScrollbackLimit: true,
        },
        cols: 2,
        rows: 1,
        isFull: true,
        fullState: makeState('c'),
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        inBandResize: false,
      },
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 3,
        isAtBottom: true,
        isAtScrollbackLimit: true,
      },
    };

    handleUnifiedUpdate(ptyId, update);

    expect(lastScrollback).toBe(3);
    expect(lastLimit).toBe(true);

    deletePtyState(ptyId);
  });

  test('stores kitty graphics updates and retains image data', () => {
    const ptyId = 'pty-kitty';
    const info = {
      id: 1,
      number: 0,
      width: 2,
      height: 2,
      dataLength: 12,
      format: KittyGraphicsFormat.RGB,
      compression: KittyGraphicsCompression.NONE,
      implicitId: false,
      transmitTime: 100n,
    };
    const placement = {
      imageId: 1,
      placementId: 9,
      placementTag: KittyGraphicsPlacementTag.INTERNAL,
      screenX: 0,
      screenY: 0,
      xOffset: 0,
      yOffset: 0,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 0,
      sourceHeight: 0,
      columns: 1,
      rows: 1,
      z: 0,
    };
    const data = new Uint8Array([1, 2, 3]);

    handlePtyKittyUpdate(ptyId, {
      images: [info],
      placements: [placement],
      removedImageIds: [],
      imageData: new Map([[info.id, data]]),
    });

    const state = getKittyState(ptyId);
    expect(state?.dirty).toBe(true);
    expect(state?.seedImageIds.has(info.id)).toBe(true);
    expect(state?.images.get(info.id)?.data).toEqual(data);
    expect(state?.placements).toHaveLength(1);

    handlePtyKittyUpdate(ptyId, {
      images: [info],
      placements: [],
      removedImageIds: [],
      imageData: new Map(),
    });

    const next = getKittyState(ptyId);
    expect(next?.images.get(info.id)?.data).toEqual(data);
    expect(next?.seedImageIds.has(info.id)).toBe(false);

    handlePtyKittyUpdate(ptyId, {
      images: [],
      placements: [],
      removedImageIds: [info.id],
      imageData: new Map(),
    });

    const finalState = getKittyState(ptyId);
    expect(finalState?.images.size).toBe(0);

    deletePtyState(ptyId);
  });

  test('buffers kitty transmit events received before subscription', () => {
    const events: Array<{ ptyId: string; sequence: string }> = [];

    handlePtyKittyTransmit('pty-buffer', 'first-seq');
    handlePtyKittyTransmit('pty-buffer', 'second-seq');

    const unsubscribe = subscribeKittyTransmit((event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { ptyId: 'pty-buffer', sequence: 'first-seq' },
      { ptyId: 'pty-buffer', sequence: 'second-seq' },
    ]);

    handlePtyKittyTransmit('pty-buffer', 'live-seq');
    expect(events[2]).toEqual({ ptyId: 'pty-buffer', sequence: 'live-seq' });

    unsubscribe();
    deletePtyState('pty-buffer');
  });
});
