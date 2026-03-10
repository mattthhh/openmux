/**
 * Shim Server Handlers - Main orchestrator
 * Reorganized to use modular handler packages in handlers/
 */
import type net from 'net';
import { dirname } from 'path';

import type { TerminalColors } from '../terminal/terminal-colors';
import { setHostColors as setHostColorsDefault } from '../terminal/terminal-colors';
import { SHIM_SOCKET_PATH } from './protocol';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from './kitty-forwarder';
import { setNotificationForwarder } from './notification-forwarder';
import type { ShimServerState } from './server-state';
import { createRequestHandler } from './server-requests';
import { sendResponse, sendError } from './server/frames';
import { createKittyHandlers } from './server/kitty';
import { getPtyService, hasServices } from '../effect/bridge/services-instance';

// Import modular handlers
import {
  createEventSender,
  registerMapping,
  removeMappingForPty,
  attachClient,
  detachClient,
  applyHostColors,
  type WithPty,
  type ShimServerOptions,
} from './handlers';

// Default PTY accessor
const defaultWithPty: WithPty = async (fn) => {
  if (!hasServices()) {
    throw new Error('Services not initialized');
  }
  const pty = getPtyService();
  const result = fn(pty);
  return result as any;
};

/**
 * Create shim server handlers
 * Orchestrates modular handler packages for different concerns
 */
export function createServerHandlers(state: ShimServerState, options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  // Create event sender
  const sendEvent = createEventSender(state);

  // Create kitty handlers
  const kittyHandlers = createKittyHandlers(state, sendEvent);

  // Create request handler with dependencies
  const handleRequest = createRequestHandler({
    state,
    withPty,
    applyHostColors: (colors) => applyHostColors(withPty, setHostColors, colors),
    sendResponse,
    sendError,
    attachClient: (socket, clientId) => attachClient(state, withPty, sendEvent, kittyHandlers, socket, clientId),
    registerMapping: (sessionId, paneId, ptyId) => registerMapping(state, sessionId, paneId, ptyId),
    removeMappingForPty: (ptyId) => removeMappingForPty(state, ptyId),
  });

  return {
    socketPath,
    socketDir,
    handleRequest,
    detachClient: (socket: net.Socket) => detachClient(state, socket),
  };
}

// Re-export handler types for convenience
export type { WithPty, ShimServerOptions } from './handlers';
