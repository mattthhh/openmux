/**
 * Shim Subscription Handler - Smoke Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createShimServerState } from '../server-state';
import {
  subscribeToPty,
  unsubscribeFromPty,
  subscribeAllPtys,
  cleanupCurrentClientBindings,
} from './subscription';
import type { WithPty } from './types';
import type { KittyHandlers } from '../server/kitty';

// Mock PTY service
const createMockPtyService = () => ({
  listAll: async () => ['pty-1', 'pty-2'],
  getEmulator: async () => ({
    getTerminalState: () => ({ cells: [], cursor: { x: 0, y: 0 } }),
    getKittyImageIds: () => [],
  }),
  subscribeUnified: async (_id: any, callback: any) => {
    callback({ 
      terminalUpdate: { 
        dirtyRows: new Map(),
        cursor: { x: 0, y: 0, visible: true },
        scrollState: { viewportOffset: 0, isAtBottom: true, scrollbackLength: 0 },
        cols: 80,
        rows: 24,
      }, 
      scrollState: { viewportOffset: 0, isAtBottom: true } 
    });
    return () => {};
  },
  onExit: async (_id: any, callback: any) => {
    return () => {};
  },
});

const mockWithPty: WithPty = async (fn) => {
  return fn(createMockPtyService());
};

const mockSendEvent = () => {};

const mockKittyHandlers: KittyHandlers = {
  sendKittyTransmit: () => {},
  sendKittyUpdate: () => {},
  queueKittyUpdate: () => {},
  hasCachedTransmit: () => false,
};

describe('shim handlers/subscription (smoke)', () => {
  let state: ReturnType<typeof createShimServerState>;

  beforeEach(() => {
    state = createShimServerState();
  });

  it('should subscribe to a PTY', async () => {
    const result = await subscribeToPty(
      state,
      mockWithPty,
      mockSendEvent,
      mockKittyHandlers,
      'pty-1'
    );

    expect(result).not.toBeInstanceOf(Error);
    expect(state.ptySubscriptions.has('pty-1')).toBe(true);
  });

  it('should not error when subscribing to already-subscribed PTY', async () => {
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    const result = await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    
    expect(result).toBeUndefined();
  });

  it('should unsubscribe from a PTY', async () => {
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    
    await unsubscribeFromPty(state, 'pty-1');
    
    expect(state.ptySubscriptions.has('pty-1')).toBe(false);
    expect(state.ptyEmulators.has('pty-1')).toBe(false);
    expect(state.ptyScrollStates.has('pty-1')).toBe(false);
  });

  it('should handle unsubscribe for non-subscribed PTY', async () => {
    // Should not throw
    await unsubscribeFromPty(state, 'pty-unknown');
    expect(state.ptySubscriptions.has('pty-unknown')).toBe(false);
  });

  it('should subscribe to all PTYs', async () => {
    const result = await subscribeAllPtys(
      state,
      mockWithPty,
      mockSendEvent,
      mockKittyHandlers
    );

    expect(result).not.toBeInstanceOf(Error);
    if (result instanceof Error) return;
    
    expect(result).toEqual(['pty-1', 'pty-2']);
    expect(state.ptySubscriptions.size).toBe(2);
  });

  it('should cleanup all client bindings', async () => {
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-2');
    
    await cleanupCurrentClientBindings(state);
    
    expect(state.ptySubscriptions.size).toBe(0);
    expect(state.bootstrappingPtyIds.size).toBe(0);
  });

  it('should preserve kitty state when requested', async () => {
    state.kittyImages.set('pty-1', { main: new Map(), alt: new Map() });
    state.kittyTransmitCache.set('pty-1', new Map());
    
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    await unsubscribeFromPty(state, 'pty-1', { preserveKittyState: true });
    
    expect(state.kittyImages.has('pty-1')).toBe(true);
    expect(state.kittyTransmitCache.has('pty-1')).toBe(true);
  });

  it('should remove kitty state by default', async () => {
    state.kittyImages.set('pty-1', { main: new Map(), alt: new Map() });
    state.kittyTransmitCache.set('pty-1', new Map());
    
    await subscribeToPty(state, mockWithPty, mockSendEvent, mockKittyHandlers, 'pty-1');
    await unsubscribeFromPty(state, 'pty-1');
    
    expect(state.kittyImages.has('pty-1')).toBe(false);
    expect(state.kittyTransmitCache.has('pty-1')).toBe(false);
  });
});
