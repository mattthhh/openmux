/**
 * Shim Lifecycle and Title Management
 * Handles PTY lifecycle events and title changes
 */
import * as errore from 'errore';
import { ShimConnectionError } from '../../effect/errors';
import type { ShimHandlerContext } from './types';
import { subscribeToPty, unsubscribeFromPty } from './subscription';
import { removeMappingForPty } from './mapping';

/**
 * Subscribe to PTY lifecycle events (created/destroyed).
 */
export async function handleLifecycle(
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, withPty, sendEvent, kittyHandlers } = context;

  const result = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () =>
      withPty((pty) =>
        pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
          const ptyId = String(event.ptyId);
          if (event.type === 'created') {
            subscribeToPty(context, ptyId).catch((e) => {
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
 * Subscribe to title changes across all PTYs.
 */
export async function handleTitles(
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, withPty, sendEvent } = context;

  const result = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () =>
      withPty((pty) =>
        pty.subscribeToTitle((event: { ptyId: string; title: string }) => {
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
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, withPty, sendEvent } = context;

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
