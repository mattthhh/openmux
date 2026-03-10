/**
 * Shim Events Handler - Litmus Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type net from 'net';
import { createShimServerState } from '../server-state';
import {
  shouldSuppressBootstrappingEvent,
  isCurrentAttach,
  createEventSender,
  sendDetached,
} from './events';
import type { ShimHeader } from '../protocol';

describe('shim handlers/events (litmus)', () => {
  let state: ReturnType<typeof createShimServerState>;

  beforeEach(() => {
    state = createShimServerState();
  });

  describe('shouldSuppressBootstrappingEvent', () => {
    it('should not suppress when no bootstrapping PTY', () => {
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });

    it('should suppress ptyUpdate during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should suppress ptyKitty during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyKitty', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should suppress ptyKittyTransmit during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyKittyTransmit', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should not suppress when allowWhileBootstrapping is true', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header, { allowWhileBootstrapping: true })).toBe(false);
    });

    it('should not suppress other event types during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyExit', ptyId: 'pty-1', exitCode: 0 };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });

    it('should not suppress when ptyId is missing', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });
  });

  describe('isCurrentAttach', () => {
    it('should return true for matching socket, clientId, and epoch', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      state.activeClient = mockSocket;
      state.activeClientId = 'client-1';
      state.attachEpoch = 5;

      expect(isCurrentAttach(state, mockSocket, 'client-1', 5)).toBe(true);
    });

    it('should return false for different socket', () => {
      const mockSocket1 = { id: 1 } as unknown as net.Socket;
      const mockSocket2 = { id: 2 } as unknown as net.Socket;
      state.activeClient = mockSocket1;
      state.activeClientId = 'client-1';
      state.attachEpoch = 5;

      expect(isCurrentAttach(state, mockSocket2, 'client-1', 5)).toBe(false);
    });

    it('should return false for different clientId', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      state.activeClient = mockSocket;
      state.activeClientId = 'client-1';
      state.attachEpoch = 5;

      expect(isCurrentAttach(state, mockSocket, 'client-2', 5)).toBe(false);
    });

    it('should return false for different epoch', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      state.activeClient = mockSocket;
      state.activeClientId = 'client-1';
      state.attachEpoch = 5;

      expect(isCurrentAttach(state, mockSocket, 'client-1', 6)).toBe(false);
    });
  });

  describe('createEventSender', () => {
    it('should return a function', () => {
      const sender = createEventSender(state);
      expect(sender).toBeTypeOf('function');
    });

    it('should not send when no active client', () => {
      const sender = createEventSender(state);
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      
      // Should not throw
      sender(header, []);
    });
  });
});
