import type net from 'net';
import type { TerminalScrollState } from '../core/types';
import type {
  IKittyGraphicsEmulator,
  ITerminalEmulator,
  KittyGraphicsImageInfo,
} from '../terminal/emulator-interface';

/** Screen identifier for Kitty graphics (main or alternate screen) */
export type KittyScreenKey = 'main' | 'alt';

/** Kitty graphics images per screen */
export type KittyScreenImages = {
  main: Map<number, KittyGraphicsImageInfo>;
  alt: Map<number, KittyGraphicsImageInfo>;
};

/** Handle for unsubscribing from PTY updates */
export type PtySubscriptionHandle = {
  /** Unsubscribe function to stop receiving updates */
  unsubscribe: () => void;
};

type PtySubscriptions = Map<string, PtySubscriptionHandle>;

type ShimPtyEmulator = ITerminalEmulator & Partial<IKittyGraphicsEmulator>;

const MAX_REVOKED_CLIENT_IDS = 32;

/**
 * Central state container for the shim server.
 *
 * Single-client lock semantics:
 * - `activeClient` / `activeClientId` identify the only socket allowed to issue
 *   non-hello requests and receive live events.
 * - A new hello steals the lock, detaches the previous socket, and becomes the
 *   sole event sink for bootstrap replay + live updates.
 * - Async bootstrap work re-checks the active socket/client pair before sending
 *   replay frames, so socket identity is the concurrency guard.
 *
 * Revoked client policy:
 * - Detached client IDs are added to `revokedClientIds` so an old UI process
 *   cannot immediately reconnect after losing the lock.
 * - The set is bounded by `MAX_REVOKED_CLIENT_IDS`; oldest IDs are purged in
 *   FIFO order to avoid unbounded growth.
 */
export type ShimServerState = {
  sessionPanes: Map<string, Map<string, string>>;
  ptyToPane: Map<string, { sessionId: string; paneId: string }>;
  clientIds: Map<net.Socket, string>;
  revokedClientIds: Set<string>;
  revokedClientOrder: string[];
  ptySubscriptions: PtySubscriptions;
  ptyEmulators: Map<string, ShimPtyEmulator>;
  ptyScrollStates: Map<string, TerminalScrollState>;
  kittyImages: Map<string, KittyScreenImages>;
  kittyTransmitCache: Map<string, Map<string, string[]>>;
  kittyTransmitPending: Map<string, Map<string, string[]>>;
  kittyTransmitInvalidated: Map<string, { all: boolean; keys: Set<string> }>;
  lifecycleUnsub: (() => void) | null;
  titleUnsub: (() => void) | null;
  activityUnsub: (() => void) | null;
  activeClient: net.Socket | null;
  activeClientId: string | null;
  bootstrappingPtyIds: Set<string>;
  hostColorsSet: boolean;
};

/**
 * Creates a fresh shim server state instance.
 * @returns New initialized ShimServerState
 */
export function createShimServerState(): ShimServerState {
  return {
    sessionPanes: new Map(),
    ptyToPane: new Map(),
    clientIds: new Map(),
    revokedClientIds: new Set(),
    revokedClientOrder: [],
    ptySubscriptions: new Map(),
    ptyEmulators: new Map(),
    ptyScrollStates: new Map(),
    kittyImages: new Map(),
    kittyTransmitCache: new Map(),
    kittyTransmitPending: new Map(),
    kittyTransmitInvalidated: new Map(),
    lifecycleUnsub: null,
    titleUnsub: null,
    activityUnsub: null,
    activeClient: null,
    activeClientId: null,
    bootstrappingPtyIds: new Set(),
    hostColorsSet: false,
  };
}

/**
 * Adds a client ID to the revoked set, maintaining bounded size.
 * Removes oldest entries when limit exceeded.
 * @param state - Server state to modify
 * @param clientId - Client ID to revoke
 */
export function rememberRevokedClientId(state: ShimServerState, clientId: string): void {
  if (state.revokedClientIds.has(clientId)) {
    return;
  }

  state.revokedClientIds.add(clientId);
  state.revokedClientOrder.push(clientId);

  while (state.revokedClientOrder.length > MAX_REVOKED_CLIENT_IDS) {
    const evicted = state.revokedClientOrder.shift();
    if (!evicted) {
      break;
    }
    state.revokedClientIds.delete(evicted);
  }
}

/**
 * Resets all shim server state to initial empty values.
 * Clears all mappings, subscriptions, and client tracking.
 * @param state - Server state to reset
 */
export function resetShimServerState(state: ShimServerState): void {
  state.sessionPanes.clear();
  state.ptyToPane.clear();
  state.clientIds.clear();
  state.revokedClientIds.clear();
  state.revokedClientOrder.length = 0;
  state.ptySubscriptions.clear();
  state.ptyEmulators.clear();
  state.ptyScrollStates.clear();
  state.kittyImages.clear();
  state.kittyTransmitCache.clear();
  state.kittyTransmitPending.clear();
  state.kittyTransmitInvalidated.clear();
  state.lifecycleUnsub = null;
  state.titleUnsub = null;
  state.activityUnsub = null;
  state.activeClient = null;
  state.activeClientId = null;
  state.bootstrappingPtyIds.clear();
  state.hostColorsSet = false;
}
