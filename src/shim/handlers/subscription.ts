/**
 * Shim PTY Subscription Management
 * Handles subscribing and unsubscribing from PTY updates
 */
import * as errore from 'errore';
import type { UnifiedTerminalUpdate } from '../../core/types';
import { packDirtyUpdate } from '../../terminal/cell-serialization';
import { ShimConnectionError } from '../../effect/errors';
import { asPtyId } from '../../effect/types';
import { ResourceStack } from '../../effect/resources';
import type { KittyHandlers } from '../server/kitty';
import type { ShimServerState } from '../server-state';
import type { SendEvent, WithPty, BootstrapOptions } from './types';
import { allowBootstrapReplay } from './replay';
import { removeMappingForPty } from './mapping';

/**
 * Subscribe to a PTY and begin receiving updates
 */
export async function subscribeToPty(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers,
  ptyId: string,
  options?: BootstrapOptions
): Promise<void | ShimConnectionError> {
  const canBootstrapReplay = (): boolean => allowBootstrapReplay(state, options);

  // Already subscribed - handle bootstrap replay if needed
  if (state.ptySubscriptions.has(ptyId)) {
    if (!options?.bootstrap) return;
    if (!canBootstrapReplay()) return;

    state.bootstrappingPtyIds.add(ptyId);
    const { replayPtyState } = await import('./replay');
    const replayResult = await replayPtyState(state, withPty, sendEvent, kittyHandlers, ptyId, { allowWhileBootstrapping: true });
    state.bootstrappingPtyIds.delete(ptyId);
    return replayResult;
  }

  const bootstrap = options?.bootstrap === true;
  if (bootstrap) {
    state.bootstrappingPtyIds.add(ptyId);
  }

  // Get emulator
  const emulatorResult = await errore.tryAsync<import('../../terminal/emulator-interface').ITerminalEmulator, ShimConnectionError>({
    try: () => withPty((pty) => pty.getEmulator(asPtyId(ptyId))) as Promise<import('../../terminal/emulator-interface').ITerminalEmulator>,
    catch: (e) => new ShimConnectionError({ reason: `Failed to get emulator for PTY ${ptyId}: ${e}`, cause: e }),
  });
  
  if (emulatorResult instanceof ShimConnectionError) {
    if (bootstrap) state.bootstrappingPtyIds.delete(ptyId);
    return emulatorResult;
  }

  state.ptyEmulators.set(ptyId, emulatorResult);

  // Subscribe to unified updates
  const unifiedUnsubResult = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () => withPty((pty) =>
      pty.subscribeUnified(asPtyId(ptyId), (update: UnifiedTerminalUpdate) => {
        state.ptyScrollStates.set(ptyId, update.scrollState);

        const packed = packDirtyUpdate(update.terminalUpdate);
        const payloads: ArrayBuffer[] = [
          packed.dirtyRowIndices.buffer.slice(0) as ArrayBuffer,
          packed.dirtyRowData as ArrayBuffer,
          (packed.fullStateData ?? new ArrayBuffer(0)) as ArrayBuffer,
        ];

        sendEvent({
          type: 'ptyUpdate',
          ptyId,
          packed: {
            cursor: packed.cursor,
            cols: packed.cols,
            rows: packed.rows,
            scrollbackLength: packed.scrollbackLength,
            isFull: packed.isFull,
            alternateScreen: packed.alternateScreen,
            mouseTracking: packed.mouseTracking,
            cursorKeyMode: packed.cursorKeyMode,
            kittyKeyboardFlags: packed.kittyKeyboardFlags,
            inBandResize: packed.inBandResize,
          },
          scrollState: {
            viewportOffset: update.scrollState.viewportOffset,
            isAtBottom: update.scrollState.isAtBottom,
          },
          payloadLengths: payloads.map((payload) => payload.byteLength),
        }, payloads, { allowWhileBootstrapping: canBootstrapReplay() });

        const kittyEmulator = state.ptyEmulators.get(ptyId);
        if (kittyEmulator) {
          kittyHandlers.sendKittyUpdate(ptyId, kittyEmulator, false, {
            allowWhileBootstrapping: canBootstrapReplay(),
          });
        }
      })
    ),
    catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to unified updates: ${e}`, cause: e }),
  });
  
  if (unifiedUnsubResult instanceof ShimConnectionError) {
    if (bootstrap) state.bootstrappingPtyIds.delete(ptyId);
    return unifiedUnsubResult;
  }

  // Subscribe to exit events
  const exitUnsubResult = await errore.tryAsync<() => void, ShimConnectionError>({
    try: () => withPty((pty) =>
      pty.onExit(asPtyId(ptyId), (exitCode: number) => {
        removeMappingForPty(state, ptyId);
        sendEvent({ type: 'ptyExit', ptyId, exitCode });
      })
    ),
    catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to exit events: ${e}`, cause: e }),
  });
  
  if (exitUnsubResult instanceof ShimConnectionError) {
    if (bootstrap) state.bootstrappingPtyIds.delete(ptyId);
    return exitUnsubResult;
  }

  state.ptySubscriptions.set(ptyId, { unifiedUnsub: unifiedUnsubResult, exitUnsub: exitUnsubResult });
  if (bootstrap) {
    state.bootstrappingPtyIds.delete(ptyId);
  }
}

/**
 * Unsubscribe from a PTY and cleanup resources
 */
export async function unsubscribeFromPty(
  state: ShimServerState,
  ptyId: string,
  options?: { preserveKittyState?: boolean }
): Promise<void> {
  const subs = state.ptySubscriptions.get(ptyId);
  if (!subs) return;

  await using resources = new ResourceStack();

  resources.registerSubscription(subs.unifiedUnsub);
  resources.registerSubscription(subs.exitUnsub);

  resources.deferSafe(() => { state.ptySubscriptions.delete(ptyId); });
  resources.deferSafe(() => { state.ptyEmulators.delete(ptyId); });
  resources.deferSafe(() => { state.ptyScrollStates.delete(ptyId); });
  resources.deferSafe(() => { state.bootstrappingPtyIds.delete(ptyId); });

  if (!options?.preserveKittyState) {
    resources.deferSafe(() => { state.kittyImages.delete(ptyId); });
    resources.deferSafe(() => { state.kittyTransmitCache.delete(ptyId); });
    resources.deferSafe(() => { state.kittyTransmitPending.delete(ptyId); });
    resources.deferSafe(() => { state.kittyTransmitInvalidated.delete(ptyId); });
  }
}

/**
 * Subscribe to all active PTYs
 */
export async function subscribeAllPtys(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers,
  options?: BootstrapOptions
): Promise<string[] | ShimConnectionError> {
  const ptyIdsResult = await errore.tryAsync<string[], ShimConnectionError>({
    try: () => withPty((pty) => pty.listAll()) as Promise<string[]>,
    catch: (e) => new ShimConnectionError({ reason: `Failed to list PTYs: ${e}`, cause: e }),
  });
  
  if (ptyIdsResult instanceof ShimConnectionError) return ptyIdsResult;

  await Promise.all(
    ptyIdsResult.map(async (id) => {
      const result = await subscribeToPty(state, withPty, sendEvent, kittyHandlers, String(id), options);
      if (result instanceof ShimConnectionError) {
        console.warn(`Failed to subscribe to PTY ${id}:`, result.message);
      }
    })
  );
  
  return ptyIdsResult;
}

/**
 * Cleanup all current client subscriptions
 */
export async function cleanupCurrentClientBindings(
  state: ShimServerState,
  options?: { preserveKittyState?: boolean }
): Promise<void> {
  await using resources = new ResourceStack();

  state.bootstrappingPtyIds.clear();

  for (const ptyId of [...state.ptySubscriptions.keys()]) {
    resources.defer(() => unsubscribeFromPty(state, ptyId, { preserveKittyState: options?.preserveKittyState }).catch((e) => {
      console.warn(`Failed to unsubscribe from PTY ${ptyId}:`, e);
    }));
  }

  if (state.lifecycleUnsub) {
    resources.registerSubscription(state.lifecycleUnsub);
    resources.deferSafe(() => { state.lifecycleUnsub = null; });
  }
  if (state.titleUnsub) {
    resources.registerSubscription(state.titleUnsub);
    resources.deferSafe(() => { state.titleUnsub = null; });
  }
}
