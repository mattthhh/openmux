/**
 * Shim Event Handling
 * Event sending utilities and bootstrapping suppression logic
 */
import type { ShimHeader } from '../protocol';
import type { ShimServerState } from '../server-state';
import { sendFrame } from '../server/frames';
import type { SendEvent } from './types';
import type net from 'net';

/**
 * Check if an event should be suppressed during bootstrapping
 */
export function shouldSuppressBootstrappingEvent(
  state: ShimServerState,
  header: ShimHeader,
  options?: { allowWhileBootstrapping?: boolean }
): boolean {
  const ptyId = typeof header.ptyId === 'string' ? header.ptyId : null;
  if (!ptyId || !state.bootstrappingPtyIds.has(ptyId)) return false;
  if (options?.allowWhileBootstrapping) return false;
  return (
    header.type === 'ptyUpdate' || header.type === 'ptyKitty' || header.type === 'ptyKittyTransmit'
  );
}

/**
 * Check if a socket/context is still the current active attach
 */
export function isCurrentAttach(
  state: ShimServerState,
  socket: net.Socket,
  clientId: string
): boolean {
  return state.activeClient === socket && state.activeClientId === clientId;
}

/**
 * Create event sender function bound to server state
 */
export function createEventSender(state: ShimServerState): SendEvent {
  return (
    header: ShimHeader,
    payloads: ArrayBuffer[] = [],
    options?: { allowWhileBootstrapping?: boolean }
  ) => {
    if (!state.activeClient) return;
    if (shouldSuppressBootstrappingEvent(state, header, options)) return;
    sendFrame(state.activeClient, header, payloads);
  };
}

/**
 * Send a detached notification to a client
 */
export function sendDetached(socket: net.Socket): void {
  sendFrame(socket, { type: 'detached' });
}
