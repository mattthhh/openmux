import type net from 'net';
import { describe, expect, it, vi } from 'bun:test';

import { createServerHandlers } from '../../src/shim/server-handlers';
import { createShimServerState } from '../../src/shim/server-state';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  type KittyGraphicsImageInfo,
} from '../../src/terminal/emulator-interface';

const makeImageInfo = (id: number): KittyGraphicsImageInfo => ({
  id,
  number: 0,
  width: 2,
  height: 2,
  dataLength: 4,
  format: KittyGraphicsFormat.RGB,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime: 1n,
});

describe('createServerHandlers detach behavior', () => {
  it('preserves kitty replay state across detach', async () => {
    const state = createShimServerState();
    const handlers = createServerHandlers(state, {
      withPty: async (fn) => fn({
        listAll: () => [],
        subscribeToLifecycle: () => () => {},
        subscribeToAllTitleChanges: () => () => {},
      }),
      setHostColors: () => {},
    });

    const socket = { destroyed: false } as unknown as net.Socket;
    state.activeClient = socket;

    const unifiedUnsub = vi.fn();
    const exitUnsub = vi.fn();
    state.ptySubscriptions.set('pty-1', { unifiedUnsub, exitUnsub });
    state.ptyEmulators.set('pty-1', {} as never);

    const transmitSeq = '\x1b_Ga=t,f=24,i=1;AQID\x1b\\';
    state.kittyTransmitCache.set('pty-1', new Map([['i:1', [transmitSeq]]]));
    state.kittyTransmitPending.set('pty-1', new Map([['i:2', ['pending']]]));
    state.kittyTransmitInvalidated.set('pty-1', { all: false, keys: new Set(['i:3']) });

    state.kittyImages.set('pty-1', {
      main: new Map([[1, makeImageInfo(1)]]),
      alt: new Map(),
    });

    await handlers.detachClient(socket);

    expect(state.activeClient).toBeNull();
    expect(state.ptySubscriptions.size).toBe(0);
    expect(state.ptyEmulators.has('pty-1')).toBe(false);

    // Detach should keep kitty replay data so the next client can restore images.
    expect(state.kittyTransmitCache.has('pty-1')).toBe(true);
    expect(state.kittyTransmitPending.has('pty-1')).toBe(true);
    expect(state.kittyTransmitInvalidated.has('pty-1')).toBe(true);
    expect(state.kittyImages.has('pty-1')).toBe(true);

    expect(unifiedUnsub).toHaveBeenCalledTimes(1);
    expect(exitUnsub).toHaveBeenCalledTimes(1);
  });
});
