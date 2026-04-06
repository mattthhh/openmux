import { describe, expect, it } from 'bun:test';

import { createShimServerState } from '../server-state';
import type { ShimHandlerContext } from './types';
import { handleTitles } from './lifecycle';

describe('shim handlers/lifecycle', () => {
  it('subscribes to global title events through subscribeToTitle', async () => {
    const state = createShimServerState();
    const sentEvents: Array<Record<string, unknown>> = [];
    let emitTitle: ((event: { ptyId: string; title: string }) => void) | null = null;

    const context: ShimHandlerContext = {
      state,
      withPty: async (fn) =>
        fn({
          subscribeToTitle: (callback: (event: { ptyId: string; title: string }) => void) => {
            emitTitle = callback;
            return () => {};
          },
        } as any),
      sendEvent: (header) => {
        sentEvents.push(header as Record<string, unknown>);
      },
      sendResponse: () => {},
      sendError: () => {},
      kittyHandlers: {
        sendKittyTransmit: () => {},
        sendKittyUpdate: () => {},
        queueKittyUpdate: () => {},
        hasCachedTransmit: () => false,
      },
      applyHostColors: () => {},
    };

    const result = await handleTitles(context);

    expect(result).toBeUndefined();
    expect(typeof state.titleUnsub).toBe('function');

    emitTitle?.({ ptyId: 'pty-1', title: 'shell' });

    expect(sentEvents).toEqual([{ type: 'ptyTitle', ptyId: 'pty-1', title: 'shell' }]);
  });
});
