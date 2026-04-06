import type { KittyGraphicsImageInfo } from '../../emulator-interface';
import { buildGuestKey, type TransmitParams } from '../sequence-utils';
import type { OffloadState } from './offload-manager';

export type PendingChunk = {
  guestKey: string;
  hostId: number;
  params: TransmitParams;
  offload: OffloadState | null;
};

type PtyBrokerState = {
  hostIdByGuestKey: Map<string, number>;
  pendingChunk: PendingChunk | null;
  stubbedGuestKeys: Set<string>;
  nextSyntheticGuestId: number;
};

export type ResolvedTransmitTarget = {
  guestKey: string;
  hostId: number;
  injectedGuestId: string | null;
};

/**
 * Maps guest (application) image IDs to host (terminal) image IDs.
 *
 * Each PTY maintains its own mapping namespace:
 * - Guest IDs come from the application (via i= or I= parameters)
 * - Host IDs are assigned sequentially by this mapper
 *
 * The mapper also tracks:
 * - Pending chunked transmissions (multi-part image data)
 * - Stubbed guest keys (images that were stubbed for emulator)
 * - Synthetic IDs for anonymous images
 */
export class IdMapper {
  private nextHostImageId = 1;
  private stateByPty = new Map<string, PtyBrokerState>();

  dispose(): void {
    this.stateByPty.clear();
  }

  clearPty(ptyId: string): PendingChunk | null {
    const pendingChunk = this.stateByPty.get(ptyId)?.pendingChunk ?? null;
    this.stateByPty.delete(ptyId);
    return pendingChunk;
  }

  getPendingChunk(ptyId: string): PendingChunk | null {
    return this.stateByPty.get(ptyId)?.pendingChunk ?? null;
  }

  setPendingChunk(ptyId: string, pendingChunk: PendingChunk | null): void {
    const state = pendingChunk ? this.getState(ptyId) : this.stateByPty.get(ptyId);
    if (!state) return;
    state.pendingChunk = pendingChunk;
  }

  getStubbedGuestKeys(ptyId: string): Set<string> {
    return this.getState(ptyId).stubbedGuestKeys;
  }

  /**
   * Resolve the host image ID for a given guest image reference.
   * Searches by both ID (i:) and number (I:) in that order.
   *
   * @param ptyId - PTY identifier
   * @param info - Guest image info with id and/or number
   * @returns Host image ID if found, null otherwise
   */
  resolveHostId(ptyId: string, info: KittyGraphicsImageInfo): number | null {
    const state = this.stateByPty.get(ptyId);
    if (!state) return null;

    const idKey = buildGuestKey(info.id, null);
    if (idKey && state.hostIdByGuestKey.has(idKey)) {
      return state.hostIdByGuestKey.get(idKey) ?? null;
    }

    const numberKey = info.number > 0 ? buildGuestKey(null, info.number) : null;
    if (numberKey && state.hostIdByGuestKey.has(numberKey)) {
      return state.hostIdByGuestKey.get(numberKey) ?? null;
    }

    return null;
  }

  /**
   * Resolve the transmit target for a guest sequence.
   *
   * This either:
   * - Returns existing guest key if the image was already transmitted
   * - Creates a new synthetic guest ID for anonymous transmissions
   * - Assigns a new host ID for the transmission
   *
   * @returns Resolved target with guestKey, hostId, and optional injectedGuestId
   */
  resolveTransmitTarget(params: {
    ptyId: string;
    guestId: string | null;
    guestNumber: string | null;
    fallbackGuestKey: string | null;
  }): ResolvedTransmitTarget | null {
    const { ptyId, guestId, guestNumber, fallbackGuestKey } = params;
    const state = this.getState(ptyId);

    let guestKey = buildGuestKey(guestId, guestNumber) ?? fallbackGuestKey;
    let injectedGuestId: string | null = null;

    if (!guestKey) {
      injectedGuestId = String(state.nextSyntheticGuestId);
      state.nextSyntheticGuestId = nextSynthetic(state.nextSyntheticGuestId);
      guestKey = buildGuestKey(injectedGuestId, null);
    }

    if (!guestKey) return null;

    let hostId = state.hostIdByGuestKey.get(guestKey);
    if (!hostId) {
      hostId = this.nextHostImageId++;
      state.hostIdByGuestKey.set(guestKey, hostId);
    }

    return { guestKey, hostId, injectedGuestId };
  }

  deleteGuestKey(ptyId: string, guestKey: string): number | null {
    const state = this.stateByPty.get(ptyId);
    if (!state) return null;

    const hostId = state.hostIdByGuestKey.get(guestKey) ?? null;
    state.hostIdByGuestKey.delete(guestKey);
    state.stubbedGuestKeys.delete(guestKey);
    this.cleanupState(ptyId, state);
    return hostId;
  }

  dropMapping(ptyId: string, info: KittyGraphicsImageInfo): void {
    const state = this.stateByPty.get(ptyId);
    if (!state) return;

    const idKey = buildGuestKey(info.id, null);
    if (idKey) {
      state.hostIdByGuestKey.delete(idKey);
      state.stubbedGuestKeys.delete(idKey);
    }

    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) {
        state.hostIdByGuestKey.delete(numberKey);
        state.stubbedGuestKeys.delete(numberKey);
      }
    }

    this.cleanupState(ptyId, state);
  }

  private getState(ptyId: string): PtyBrokerState {
    let state = this.stateByPty.get(ptyId);
    if (!state) {
      state = {
        hostIdByGuestKey: new Map(),
        pendingChunk: null,
        stubbedGuestKeys: new Set(),
        nextSyntheticGuestId: 2147483647,
      };
      this.stateByPty.set(ptyId, state);
    }
    return state;
  }

  private cleanupState(ptyId: string, state: PtyBrokerState): void {
    if (state.hostIdByGuestKey.size === 0 && !state.pendingChunk) {
      this.stateByPty.delete(ptyId);
    }
  }
}

function nextSynthetic(current: number): number {
  const next = current + 1;
  if (next > 0xffffffff) return 2147483647;
  return next;
}
