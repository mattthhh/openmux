import { describe, expect, it } from 'bun:test';

import type { UnifiedTerminalUpdate } from '../../core/types';
import { createShimServerState } from '../server-state';
import { subscribeToPty, unsubscribeFromPty } from './subscription';
import type { ShimHandlerContext } from './types';

function createContext() {
  const state = createShimServerState();
  const sentHeaders: Array<{ header: Record<string, unknown>; payloadCount: number }> = [];
  const kittyUpdates: string[] = [];
  let unifiedCallback: ((update: UnifiedTerminalUpdate) => void) | null = null;
  let exitCallback: ((exitCode: number) => void) | null = null;
  let unifiedUnsubscribed = false;
  let exitUnsubscribed = false;

  const emulator = {
    getTerminalState: () => ({
      cols: 80,
      rows: 24,
      cells: [],
      cursor: { x: 0, y: 0, visible: true },
      alternateScreen: false,
      mouseTracking: false,
      cursorKeyMode: 'normal',
      kittyKeyboardFlags: 0,
    }),
  } as any;

  const context: ShimHandlerContext = {
    state,
    withPty: async (fn) =>
      fn({
        getEmulator: () => emulator,
        subscribe: (_ptyId: string, callback: (update: UnifiedTerminalUpdate) => void) => {
          unifiedCallback = callback;
          return () => {
            unifiedUnsubscribed = true;
          };
        },
        onExit: (_ptyId: string, callback: (exitCode: number) => void) => {
          exitCallback = callback;
          return () => {
            exitUnsubscribed = true;
          };
        },
        listAll: () => ['pty-1'],
      }),
    sendEvent: (header, payloads = []) => {
      sentHeaders.push({
        header: header as Record<string, unknown>,
        payloadCount: payloads.length,
      });
    },
    sendResponse: () => {},
    sendError: () => {},
    kittyHandlers: {
      sendKittyTransmit: () => {},
      sendKittyUpdate: (ptyId) => {
        kittyUpdates.push(ptyId);
      },
      queueKittyUpdate: () => {},
      hasCachedTransmit: () => false,
    },
    applyHostColors: () => {},
  };

  return {
    context,
    state,
    sentHeaders,
    kittyUpdates,
    emitUnified(update: UnifiedTerminalUpdate) {
      unifiedCallback?.(update);
    },
    emitExit(exitCode: number) {
      exitCallback?.(exitCode);
    },
    wasUnifiedUnsubscribed: () => unifiedUnsubscribed,
    wasExitUnsubscribed: () => exitUnsubscribed,
  };
}

describe('shim handlers/subscription', () => {
  it('subscribes through a single stored handle and forwards update + exit events', async () => {
    const fixture = createContext();

    const result = await subscribeToPty(fixture.context, 'pty-1');
    expect(result).toBeUndefined();
    expect(fixture.state.ptySubscriptions.has('pty-1')).toBe(true);

    fixture.emitUnified({
      terminalUpdate: {
        dirtyRows: new Map(),
        cursor: { x: 1, y: 2, visible: true },
        scrollState: {
          viewportOffset: 0,
          scrollbackLength: 3,
          isAtBottom: true,
        },
        cols: 80,
        rows: 24,
        isFull: true,
        fullState: fixture.context.state.ptyEmulators.get('pty-1')?.getTerminalState() as any,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
        inBandResize: false,
      },
      scrollState: {
        viewportOffset: 0,
        scrollbackLength: 3,
        isAtBottom: true,
      },
    });

    fixture.emitExit(17);

    expect(fixture.sentHeaders.some((entry) => entry.header.type === 'ptyUpdate')).toBe(true);
    expect(fixture.sentHeaders.some((entry) => entry.header.type === 'ptyExit')).toBe(true);
    expect(fixture.kittyUpdates).toEqual(['pty-1']);
  });

  it('runs both underlying unsubscribers when a PTY is removed', async () => {
    const fixture = createContext();

    await subscribeToPty(fixture.context, 'pty-1');
    await unsubscribeFromPty(fixture.state, 'pty-1');

    expect(fixture.wasUnifiedUnsubscribed()).toBe(true);
    expect(fixture.wasExitUnsubscribed()).toBe(true);
    expect(fixture.state.ptySubscriptions.has('pty-1')).toBe(false);
  });
});
