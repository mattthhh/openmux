import type net from 'net';
import { dirname } from 'path';
import * as errore from 'errore';

import { asPtyId } from '../effect/types';
import { ResourceStack } from '../effect/resources.js';
import type { UnifiedTerminalUpdate, TerminalScrollState, TerminalState, DirtyTerminalUpdate } from '../core/types';
import { packDirtyUpdate } from '../terminal/cell-serialization';
import type { ITerminalEmulator } from '../terminal/emulator-interface';
import { setHostColors as setHostColorsDefault, type TerminalColors } from '../terminal/terminal-colors';
import { buildGuestKey } from '../terminal/kitty-graphics/sequence-utils';
import { SHIM_SOCKET_PATH, type ShimHeader } from './protocol';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from './kitty-forwarder';
import { setNotificationForwarder } from './notification-forwarder';
import type { ShimServerState } from './server-state';
import { createRequestHandler } from './server-requests';
import { sendFrame, sendResponse, sendError } from './server/frames';
import { createKittyHandlers } from './server/kitty';
import { ShimConnectionError } from '../effect/errors';

export type WithPty = <A>(fn: (pty: any) => Promise<A> | A) => Promise<A>;

export type ShimServerOptions = {
  socketPath?: string;
  withPty?: WithPty;
  setHostColors?: (colors: TerminalColors) => void;
};

const defaultWithPty: WithPty = async (fn) => {
  const { getPtyService, hasServices } = await import('../effect/bridge/services-instance');
  if (!hasServices()) {
    throw new Error('Services not initialized');
  }
  const pty = getPtyService();
  const result = fn(pty);
  return result as any;
};

export function createServerHandlers(state: ShimServerState, options?: ShimServerOptions) {
  const socketPath = options?.socketPath ?? SHIM_SOCKET_PATH;
  const socketDir = dirname(socketPath);
  const withPty = options?.withPty ?? defaultWithPty;
  const setHostColors = options?.setHostColors ?? setHostColorsDefault;

  const applyHostColors = async (colors: TerminalColors): Promise<void> => {
    setHostColors(colors);
    const result = await errore.tryAsync<void, ShimConnectionError>({
      try: () => withPty((pty) => pty.setHostColors(colors)),
      catch: (e) => new ShimConnectionError({ reason: `Failed to apply host colors: ${e}`, cause: e }),
    });
    if (result instanceof ShimConnectionError) {
      console.warn('Failed to apply host colors:', result.message);
    }
  };

  const sendEvent = (header: ShimHeader, payloads: ArrayBuffer[] = []) => {
    if (!state.activeClient) return;
    sendFrame(state.activeClient, header, payloads);
  };

  const { sendKittyTransmit, sendKittyUpdate, queueKittyUpdate } = createKittyHandlers(state, sendEvent);

  function registerMapping(sessionId: string, paneId: string, ptyId: string): void {
    const map = state.sessionPanes.get(sessionId) ?? new Map<string, string>();
    map.set(paneId, ptyId);
    state.sessionPanes.set(sessionId, map);
    state.ptyToPane.set(ptyId, { sessionId, paneId });
  }

  function removeMappingForPty(ptyId: string): void {
    const info = state.ptyToPane.get(ptyId);
    if (!info) return;
    const map = state.sessionPanes.get(info.sessionId);
    if (map) {
      map.delete(info.paneId);
      if (map.size === 0) {
        state.sessionPanes.delete(info.sessionId);
      }
    }
    state.ptyToPane.delete(ptyId);
  }

  async function subscribeToPty(ptyId: string): Promise<void | ShimConnectionError> {
    if (state.ptySubscriptions.has(ptyId)) return;

    const emulatorResult = await errore.tryAsync<ITerminalEmulator, ShimConnectionError>({
      try: () => withPty((pty) => pty.getEmulator(asPtyId(ptyId))) as Promise<ITerminalEmulator>,
      catch: (e) => new ShimConnectionError({ reason: `Failed to get emulator for PTY ${ptyId}: ${e}`, cause: e }),
    });
    if (emulatorResult instanceof ShimConnectionError) return emulatorResult;
    
    state.ptyEmulators.set(ptyId, emulatorResult);

    const unifiedUnsubResult = await errore.tryAsync<() => void, ShimConnectionError>({
      try: () => withPty((pty) =>
        pty.subscribeUnified(asPtyId(ptyId), (update: UnifiedTerminalUpdate) => {
          const packed = packDirtyUpdate(update.terminalUpdate);
          const payloads: ArrayBuffer[] = [
            packed.dirtyRowIndices.buffer.slice(0) as ArrayBuffer,
            packed.dirtyRowData as ArrayBuffer,
            (packed.fullStateData ?? new ArrayBuffer(0)) as ArrayBuffer,
          ];

          const header: ShimHeader = {
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
          };

          sendEvent(header, payloads);
          const kittyEmulator = state.ptyEmulators.get(ptyId);
          if (kittyEmulator) {
            sendKittyUpdate(ptyId, kittyEmulator);
          }
        })
      ),
      catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to unified updates: ${e}`, cause: e }),
    });
    if (unifiedUnsubResult instanceof ShimConnectionError) return unifiedUnsubResult;

    const exitUnsubResult = await errore.tryAsync<() => void, ShimConnectionError>({
      try: () => withPty((pty) =>
        pty.onExit(asPtyId(ptyId), (exitCode: number) => {
          removeMappingForPty(ptyId);
          sendEvent({ type: 'ptyExit', ptyId, exitCode });
        })
      ),
      catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to exit events: ${e}`, cause: e }),
    });
    if (exitUnsubResult instanceof ShimConnectionError) return exitUnsubResult;

    state.ptySubscriptions.set(ptyId, { unifiedUnsub: unifiedUnsubResult, exitUnsub: exitUnsubResult });
  }

  async function unsubscribeFromPty(
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

    if (!options?.preserveKittyState) {
      resources.deferSafe(() => { state.kittyImages.delete(ptyId); });
      resources.deferSafe(() => { state.kittyTransmitCache.delete(ptyId); });
      resources.deferSafe(() => { state.kittyTransmitPending.delete(ptyId); });
      resources.deferSafe(() => { state.kittyTransmitInvalidated.delete(ptyId); });
    }
  }

  async function subscribeAllPtys(): Promise<string[] | ShimConnectionError> {
    const ptyIdsResult = await errore.tryAsync<string[], ShimConnectionError>({
      try: () => withPty((pty) => pty.listAll()) as Promise<string[]>,
      catch: (e) => new ShimConnectionError({ reason: `Failed to list PTYs: ${e}`, cause: e }),
    });
    if (ptyIdsResult instanceof ShimConnectionError) return ptyIdsResult;

    // Subscribe to all PTYs in parallel for faster client attachment
    await Promise.all(
      ptyIdsResult.map(async (id) => {
        const result = await subscribeToPty(String(id));
        if (result instanceof ShimConnectionError) {
          console.warn(`Failed to subscribe to PTY ${id}:`, result.message);
        }
      })
    );
    return ptyIdsResult;
  }

  async function handleLifecycle(): Promise<void | ShimConnectionError> {
    const result = await errore.tryAsync<() => void, ShimConnectionError>({
      try: () => withPty((pty) =>
        pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
          const ptyId = String(event.ptyId);
          if (event.type === 'created') {
            subscribeToPty(ptyId).catch((e) => {
              console.warn(`Failed to subscribe to new PTY ${ptyId}:`, e);
            });
          } else {
            unsubscribeFromPty(ptyId).catch((e) => {
              console.warn(`Failed to unsubscribe from PTY ${ptyId}:`, e);
            });
            removeMappingForPty(ptyId);
          }
          sendEvent({ type: 'ptyLifecycle', ptyId, event: event.type });
        })
      ),
      catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to lifecycle events: ${e}`, cause: e }),
    });
    if (result instanceof ShimConnectionError) return result;
    state.lifecycleUnsub = result;
  }

  async function handleTitles(): Promise<void | ShimConnectionError> {
    const result = await errore.tryAsync<() => void, ShimConnectionError>({
      try: () => withPty((pty) =>
        pty.subscribeToAllTitleChanges((event: { ptyId: string; title: string }) => {
          sendEvent({ type: 'ptyTitle', ptyId: String(event.ptyId), title: event.title });
        })
      ),
      catch: (e) => new ShimConnectionError({ reason: `Failed to subscribe to title changes: ${e}`, cause: e }),
    });
    if (result instanceof ShimConnectionError) return result;
    state.titleUnsub = result;
  }

  async function sendSnapshot(ptyId: string): Promise<void | ShimConnectionError> {
    if (!state.activeClient) return;

    const stateResult = await errore.tryAsync<{
      state: TerminalState;
      scrollState: TerminalScrollState;
    }, ShimConnectionError>({
      try: async () => {
        return await withPty(async (pty) => {
          const s = await pty.getTerminalState(asPtyId(ptyId));
          const scrollState = await pty.getScrollState(asPtyId(ptyId));
          return { state: s, scrollState };
        }) as { state: TerminalState; scrollState: TerminalScrollState };
      },
      catch: (e) => new ShimConnectionError({ reason: `Failed to get terminal state: ${e}`, cause: e }),
    });
    if (stateResult instanceof ShimConnectionError) return stateResult;

    const update: DirtyTerminalUpdate = {
      dirtyRows: new Map(),
      cursor: stateResult.state.cursor,
      scrollState: stateResult.scrollState,
      cols: stateResult.state.cols,
      rows: stateResult.state.rows,
      isFull: true,
      fullState: stateResult.state,
      alternateScreen: stateResult.state.alternateScreen,
      mouseTracking: stateResult.state.mouseTracking,
      cursorKeyMode: stateResult.state.cursorKeyMode ?? 'normal',
      kittyKeyboardFlags: stateResult.state.kittyKeyboardFlags ?? 0,
      inBandResize: false,
    };

    const packed = packDirtyUpdate(update);
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
        viewportOffset: stateResult.scrollState.viewportOffset,
        isAtBottom: stateResult.scrollState.isAtBottom,
      },
      payloadLengths: payloads.map((payload) => payload.byteLength),
    }, payloads);

    let emulator = state.ptyEmulators.get(ptyId);
    if (!emulator) {
      const emulatorResult = await errore.tryAsync<ITerminalEmulator, ShimConnectionError>({
        try: () => withPty((pty) => pty.getEmulator(asPtyId(ptyId))) as Promise<ITerminalEmulator>,
        catch: (e) => new ShimConnectionError({ reason: `Failed to get emulator: ${e}`, cause: e }),
      });
      if (emulatorResult instanceof ShimConnectionError) return emulatorResult;
      emulator = emulatorResult;
      state.ptyEmulators.set(ptyId, emulator);
    }

    const cache = state.kittyTransmitCache.get(ptyId);
    if (cache && cache.size > 0) {
      const guestKeyHasImageData = new Map<string, boolean>();
      const imageIds = emulator.getKittyImageIds?.() ?? [];
      for (const imageId of imageIds) {
        const info = emulator.getKittyImageInfo?.(imageId);
        if (!info) continue;
        const hasImageData = Boolean(emulator.getKittyImageData?.(imageId));

        const idKey = buildGuestKey(info.id, null);
        if (idKey) {
          guestKeyHasImageData.set(idKey, hasImageData);
        }

        if (info.number > 0) {
          const numberKey = buildGuestKey(null, info.number);
          if (numberKey && !guestKeyHasImageData.has(numberKey)) {
            guestKeyHasImageData.set(numberKey, hasImageData);
          }
        }
      }

      for (const [guestKey, sequences] of cache.entries()) {
        const hasSharedMemoryChunk = sequences.some((seq) => seq.includes('t=s'));
        const allowSharedMemoryReplay = hasSharedMemoryChunk && !guestKeyHasImageData.get(guestKey);

        for (const seq of sequences) {
          sendKittyTransmit(ptyId, seq, {
            fromReplay: true,
            allowSharedMemoryReplay,
          });
        }
      }
    }
    sendKittyUpdate(ptyId, emulator, true);
  }

  async function sendSnapshots(ptyIds: string[]): Promise<void> {
    const results = await Promise.allSettled(ptyIds.map((ptyId) => sendSnapshot(ptyId)));
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        console.warn(`Failed to send snapshot for PTY ${ptyIds[i]}:`, result.reason);
      }
    }
  }

  async function attachClient(socket: net.Socket, clientId: string): Promise<void> {
    await using resources = new ResourceStack();

    const previousClient = state.activeClient;
    const previousClientId = previousClient ? state.clientIds.get(previousClient) ?? null : null;
    if (previousClient && !previousClient.destroyed) {
      sendFrame(previousClient, { type: 'detached' });
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

    state.clientIds.set(socket, clientId);
    state.activeClient = socket;
    state.activeClientId = clientId;
    setKittyTransmitForwarder(sendKittyTransmit);
    setKittyUpdateForwarder(queueKittyUpdate);
    setNotificationForwarder((event) => {
      sendEvent({
        type: 'ptyNotification',
        ptyId: event.ptyId,
        notification: event.notification,
        subtitle: event.subtitle,
      });
    });

    const ptyIdsResult = await subscribeAllPtys();
    if (ptyIdsResult instanceof ShimConnectionError) {
      console.warn('Failed to subscribe to PTYs:', ptyIdsResult.message);
      return;
    }

    const lifecycleResult = await handleLifecycle();
    if (lifecycleResult instanceof ShimConnectionError) {
      console.warn('Failed to subscribe to lifecycle:', lifecycleResult.message);
    }

    const titlesResult = await handleTitles();
    if (titlesResult instanceof ShimConnectionError) {
      console.warn('Failed to subscribe to titles:', titlesResult.message);
    }

    await sendSnapshots(ptyIdsResult);
  }

  async function detachClient(socket: net.Socket): Promise<void> {
    if (state.activeClient !== socket) return;

    await using resources = new ResourceStack();

    state.activeClient = null;
    state.activeClientId = null;
    // Keep capturing kitty transmits while detached so replay cache stays fresh.
    // sendKittyTransmit short-circuits socket sends when no active client exists.
    setKittyTransmitForwarder(sendKittyTransmit);
    setKittyUpdateForwarder(null);
    setNotificationForwarder(null);

    for (const ptyId of state.ptySubscriptions.keys()) {
      resources.defer(() => unsubscribeFromPty(ptyId, { preserveKittyState: true }).catch((e) => {
        console.warn(`Failed to unsubscribe from PTY ${ptyId} during detach:`, e);
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

  const handleRequest = createRequestHandler({
    state,
    withPty,
    applyHostColors,
    sendResponse,
    sendError,
    attachClient,
    registerMapping,
    removeMappingForPty,
  });

  return {
    socketPath,
    socketDir,
    handleRequest,
    detachClient,
  };
}
