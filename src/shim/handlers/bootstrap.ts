/**
 * Shim Client Bootstrap
 * Handles client attach/detach and bootstrap flow
 */
import * as errore from 'errore';
import type net from 'net';
import { ShimConnectionError } from '../../effect/errors';
import { ResourceStack } from '../../effect/resources';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from '../kitty-forwarder';
import { setNotificationForwarder } from '../notification-forwarder';
import type { ShimServerState } from '../server-state';
import type { SendEvent, WithPty, AttachContext } from './types';
import { isCurrentAttach, sendDetached } from './events';
import { cleanupCurrentClientBindings, subscribeAllPtys } from './subscription';
import { handleActivity, handleLifecycle, handleTitles } from './lifecycle';
import type { KittyHandlers } from '../server/kitty';

/**
 * Start attach bootstrap - subscribe to all PTYs and set up event handlers
 */
export function startAttachBootstrap(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers,
  socket: net.Socket,
  clientId: string,
  attachEpoch: number
): void {
  void (async () => {
    const ptyIdsResult = await subscribeAllPtys(state, withPty, sendEvent, kittyHandlers, {
      bootstrap: true,
      attach: { socket, clientId, attachEpoch },
    });

    if (ptyIdsResult instanceof ShimConnectionError) {
      if (isCurrentAttach(state, socket, clientId, attachEpoch)) {
        console.warn('Failed to subscribe to PTYs:', ptyIdsResult.message);
      }
      return;
    }

    if (!isCurrentAttach(state, socket, clientId, attachEpoch)) return;

    // Set up lifecycle handler
    if (!state.lifecycleUnsub) {
      const lifecycleResult = await handleLifecycle(state, withPty, sendEvent, kittyHandlers);
      if (lifecycleResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to lifecycle:', lifecycleResult.message);
      }
    }

    if (!isCurrentAttach(state, socket, clientId, attachEpoch)) return;

    // Set up titles handler
    if (!state.titleUnsub) {
      const titlesResult = await handleTitles(state, withPty, sendEvent);
      if (titlesResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to titles:', titlesResult.message);
      }
    }

    if (!isCurrentAttach(state, socket, clientId, attachEpoch)) return;

    if (!state.activityUnsub) {
      const activityResult = await handleActivity(state, withPty, sendEvent);
      if (activityResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to activity:', activityResult.message);
      }
    }
  })().catch((e) => {
    if (!isCurrentAttach(state, socket, clientId, attachEpoch)) return;
    console.warn('[shim] Attach bootstrap failed:', e);
  });
}

/**
 * Attach a new client, detaching any existing client
 */
export async function attachClient(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers,
  socket: net.Socket,
  clientId: string
): Promise<void> {
  await using resources = new ResourceStack();

  const previousClient = state.activeClient;
  const previousClientId = previousClient ? (state.clientIds.get(previousClient) ?? null) : null;

  // Clean up current bindings
  await cleanupCurrentClientBindings(state, { preserveKittyState: true });

  // Detach previous client
  if (previousClient && !previousClient.destroyed) {
    sendDetached(previousClient);
    previousClient.end();
    const prevClientRef = previousClient;
    resources.defer(() => {
      setTimeout(() => {
        if (prevClientRef && !prevClientRef.destroyed) {
          prevClientRef.destroy();
        }
      }, 250);
    });
  }

  if (previousClientId) {
    state.revokedClientIds.add(previousClientId);
  }

  // Set new active client
  state.clientIds.set(socket, clientId);
  state.activeClient = socket;
  state.activeClientId = clientId;
  state.attachEpoch += 1;

  // Set up forwarders
  setKittyTransmitForwarder(kittyHandlers.sendKittyTransmit);
  setKittyUpdateForwarder(kittyHandlers.queueKittyUpdate);
  setNotificationForwarder((event) => {
    sendEvent({
      type: 'ptyNotification',
      ptyId: event.ptyId,
      notification: event.notification,
      subtitle: event.subtitle,
    });
  });

  // Start bootstrap
  startAttachBootstrap(
    state,
    withPty,
    sendEvent,
    kittyHandlers,
    socket,
    clientId,
    state.attachEpoch
  );
}

/**
 * Detach current client
 */
export async function detachClient(state: ShimServerState, socket: net.Socket): Promise<void> {
  if (state.activeClient !== socket) return;

  state.activeClient = null;
  state.activeClientId = null;
  state.bootstrappingPtyIds.clear();

  // Keep the kitty transmit forwarder active so it continues caching transmits
  // sendKittyTransmit will record to cache but skip socket sends when no active client
  // setKittyUpdateForwarder and setNotificationForwarder are cleared as they need a client
  setKittyUpdateForwarder(null);
  setNotificationForwarder(null);

  await cleanupCurrentClientBindings(state, { preserveKittyState: true });
}

/**
 * Apply host colors to all emulators
 */
export async function applyHostColors(
  withPty: WithPty,
  setHostColors: (colors: import('../../terminal/terminal-colors').TerminalColors) => void,
  colors: import('../../terminal/terminal-colors').TerminalColors
): Promise<void> {
  setHostColors(colors);
  const result = await errore.tryAsync<void, ShimConnectionError>({
    try: () => withPty((pty) => pty.setHostColors(colors)),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to apply host colors: ${e}`, cause: e }),
  });
  if (result instanceof ShimConnectionError) {
    console.warn('Failed to apply host colors:', result.message);
  }
}
