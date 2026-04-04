/**
 * Shim Lifecycle and Title Management
 * Handles PTY lifecycle events and title changes
 */
import * as errore from 'errore';
import { ShimConnectionError } from '../../effect/errors';
import type { ShimServerState } from '../server-state';
import type { SendEvent, WithPty } from './types';
import { subscribeToPty, unsubscribeFromPty } from './subscription';
import { removeMappingForPty } from './mapping';
import type { KittyHandlers } from '../server/kitty';

/**
 * Subscribe to PTY lifecycle events (created/destroyed)
 */
export async function handleLifecycle(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers
): Promise<void | ShimConnectionError> {
  const result = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () =>
      withPty((pty) =>
        pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
          const ptyId = String(event.ptyId);
          if (event.type === 'created') {
            subscribeToPty(state, withPty, sendEvent, kittyHandlers, ptyId).catch((e) => {
              console.warn(`Failed to subscribe to new PTY ${ptyId}:`, e);
            });
          } else {
            unsubscribeFromPty(state, ptyId).catch((e) => {
              console.warn(`Failed to unsubscribe from PTY ${ptyId}:`, e);
            });
            removeMappingForPty(state, ptyId);
          }
          sendEvent({ type: 'ptyLifecycle', ptyId, event: event.type });
        })
      ),
    catch: (e) =>
      new ShimConnectionError({
        reason: `Failed to subscribe to lifecycle events: ${e}`,
        cause: e,
      }),
  });

  if (result instanceof ShimConnectionError) return result;
  state.lifecycleUnsub = result;
}

/**
 * Subscribe to title changes across all PTYs
 */
export async function handleTitles(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent
): Promise<void | ShimConnectionError> {
  const result = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () =>
      withPty((pty) =>
        pty.subscribeToAllTitleChanges((event: { ptyId: string; title: string }) => {
          sendEvent({ type: 'ptyTitle', ptyId: String(event.ptyId), title: event.title });
        })
      ),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to subscribe to title changes: ${e}`, cause: e }),
  });

  if (result instanceof ShimConnectionError) return result;
  state.titleUnsub = result;
}

/**
 * Subscribe to raw stdout activity across all PTYs.
 */
export async function handleActivity(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent
): Promise<void | ShimConnectionError> {
  const result = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () =>
      withPty((pty) =>
        pty.subscribeToAllActivity((event: { ptyId: string }) => {
          sendEvent({ type: 'ptyActivity', ptyId: String(event.ptyId) });
        })
      ),
    catch: (e) =>
      new ShimConnectionError({
        reason: `Failed to subscribe to activity changes: ${e}`,
        cause: e,
      }),
  });

  if (result instanceof ShimConnectionError) return result;
  state.activityUnsub = result;
}
