import { Buffer } from 'buffer';
import fs from 'fs';
import * as errore from 'errore';
import { KittyOffloadError } from '../../effect/errors';
import { getHostCapabilities } from '../capabilities';
import type { KittyGraphicsImageInfo } from '../emulator-interface';
import { buildDeleteImage } from './commands';
import type { RendererLike } from './types';
import { tracePtyEvent } from '../pty-trace';
import {
  buildEmulatorSequence,
  buildHostFileTransmitSequence,
  buildHostTransmitSequence,
} from './transmit-broker/sequences';
import {
  buildGuestKey,
  createTempFilePath,
  estimateDecodedSize,
  mergeTransmitParams,
  normalizeParamId,
  parseKittySequence,
  parseTransmitParams,
  rebuildControl,
  type TransmitParams,
} from './sequence-utils';
import { resolveKittyOffloadCleanupDelay, resolveKittyOffloadThreshold } from './offload-utils';

type PendingChunk = {
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

type OffloadState = {
  fd: number;
  filePath: string;
  carry: string;
  bytesWritten: number;
};

let activeBroker: KittyTransmitBroker | null = null;

export function getKittyTransmitBroker(): KittyTransmitBroker | null {
  return activeBroker;
}

export function setKittyTransmitBroker(broker: KittyTransmitBroker | null): void {
  activeBroker = broker;
}

export class KittyTransmitBroker {
  private writer: ((chunk: string) => void) | null = null;
  private enabled = getHostCapabilities()?.kittyGraphics ?? false;
  private nextHostImageId = 1;
  private stateByPty = new Map<string, PtyBrokerState>();
  private offloadThresholdBytes: number;
  private offloadCleanupDelayMs: number;
  private cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private tempFileCounter = 0;
  private pendingWrites: string[] = [];
  private autoFlush = true;
  private flushScheduled = false;
  private flushScheduler: (() => void) | null = null;
  private stubEmulator = false;
  private stubSharedMemory = true;

  constructor() {
    this.offloadThresholdBytes = resolveKittyOffloadThreshold();
    this.offloadCleanupDelayMs = resolveKittyOffloadCleanupDelay();
    const stubEnv = (process.env.OPENMUX_KITTY_EMULATOR_STUB ?? '').toLowerCase();
    this.stubEmulator = stubEnv === '1' || stubEnv === 'true';
    const stubSharedEnv = (process.env.OPENMUX_KITTY_STUB_SHARED_MEMORY ?? '').toLowerCase();
    this.stubSharedMemory = !(stubSharedEnv === '0' || stubSharedEnv === 'false');
  }

  setWriter(writer: ((chunk: string) => void) | null): void {
    this.writer = writer;
  }

  setAutoFlush(enabled: boolean): void {
    this.autoFlush = enabled;
  }

  setFlushScheduler(scheduler: (() => void) | null): void {
    this.flushScheduler = scheduler;
  }

  flushPending(writerOverride?: (chunk: string) => void): boolean {
    const writer = writerOverride ?? this.writer;
    if (!writer || this.pendingWrites.length === 0) {
      this.flushScheduled = false;
      return false;
    }
    const payload = this.pendingWrites.join('');
    this.pendingWrites = [];
    this.flushScheduled = false;
    writer(payload);
    return true;
  }

  setRenderer(renderer: RendererLike | null): void {
    if (!renderer) {
      this.writer = null;
      return;
    }
    const stdout = renderer.stdout ?? process.stdout;
    const writer = renderer.writeOut
      ? renderer.writeOut.bind(renderer)
      : renderer.realStdoutWrite
        ? renderer.realStdoutWrite.bind(stdout)
        : stdout.write.bind(stdout);
    this.writer = (chunk: string) => {
      writer(chunk);
    };
  }

  dispose(): void {
    this.stateByPty.clear();
    this.writer = null;
    this.pendingWrites = [];
    this.flushScheduled = false;
    this.flushScheduler = null;
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  clearPty(ptyId: string): void {
    const state = this.stateByPty.get(ptyId);
    if (state?.pendingChunk?.offload) {
      void this.abortOffload(state.pendingChunk.offload);
    }
    this.stateByPty.delete(ptyId);
  }

  resolveHostId(ptyId: string, info: KittyGraphicsImageInfo): number | null {
    const state = this.stateByPty.get(ptyId);
    if (!state) return null;
    const idKey = buildGuestKey(info.id, null);
    const numberKey = info.number > 0 ? buildGuestKey(null, info.number) : null;
    if (idKey && state.hostIdByGuestKey.has(idKey)) {
      return state.hostIdByGuestKey.get(idKey)!;
    }
    if (numberKey && state.hostIdByGuestKey.has(numberKey)) {
      return state.hostIdByGuestKey.get(numberKey)!;
    }
    return null;
  }

  dropMapping(ptyId: string, info: KittyGraphicsImageInfo): void {
    const state = this.stateByPty.get(ptyId);
    if (!state) return;
    const idKey = buildGuestKey(info.id, null);
    if (idKey) state.hostIdByGuestKey.delete(idKey);
    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) state.hostIdByGuestKey.delete(numberKey);
    }
    if (idKey) state.stubbedGuestKeys.delete(idKey);
    if (info.number > 0) {
      const numberKey = buildGuestKey(null, info.number);
      if (numberKey) state.stubbedGuestKeys.delete(numberKey);
    }
    if (state.hostIdByGuestKey.size === 0 && !state.pendingChunk) {
      this.stateByPty.delete(ptyId);
    }
  }

  handleSequence(ptyId: string, sequence: string): string {
    if (!this.enabled || !this.writer) return sequence;
    const parsed = parseKittySequence(sequence);
    if (!parsed) return sequence;
    const action = parsed.params.get('a');
    if (action === 'd') {
      const state = this.getState(ptyId);
      const deleteTarget = parsed.params.get('d') ?? '';
      if (deleteTarget === 'a') {
        if (state.pendingChunk?.offload) {
          void this.abortOffload(state.pendingChunk.offload);
        }
        state.pendingChunk = null;
        // Host renders are driven by the emulator state; forwarding d=a would
        // nuke images from unrelated screens/panes.
        return sequence;
      }

      if (deleteTarget === 'i' || deleteTarget === 'I') {
        const guestId = normalizeParamId(parsed.params.get('i'));
        const guestNumber = normalizeParamId(parsed.params.get('I'));
        const guestKey = buildGuestKey(guestId, guestNumber);
        if (guestKey) {
          const hostId = state.hostIdByGuestKey.get(guestKey);
          if (hostId) {
            this.enqueue(buildDeleteImage(hostId));
            state.hostIdByGuestKey.delete(guestKey);
            state.stubbedGuestKeys.delete(guestKey);
          }
        }
      }
      return sequence;
    }
    tracePtyEvent('kitty-broker-seq', {
      ptyId,
      control: parsed.control,
      dataLen: parsed.data.length,
      action: action ?? '',
      format: parsed.params.get('f') ?? '',
      medium: parsed.params.get('t') ?? '',
      more: parsed.params.get('m') ?? '',
      imageId: parsed.params.get('i') ?? '',
      imageNumber: parsed.params.get('I') ?? '',
    });
    const state = this.getState(ptyId);
    let transmit = parseTransmitParams(parsed);
    if (!transmit && state.pendingChunk) {
      const actionParam = parsed.params.get('a');
      let continuationOnlyIds = true;
      if (actionParam && actionParam !== 't' && actionParam !== 'T') {
        continuationOnlyIds = false;
      }
      for (const key of parsed.params.keys()) {
        if (key !== 'i' && key !== 'I' && key !== 'a') {
          continuationOnlyIds = false;
          break;
        }
      }
      if (continuationOnlyIds) {
        transmit = { ...state.pendingChunk.params, more: false };
      }
    }
    if (!transmit) return sequence;
    const guestId = normalizeParamId(parsed.params.get('i'));
    const guestNumber = normalizeParamId(parsed.params.get('I'));
    let guestKey = guestId || guestNumber ? buildGuestKey(guestId, guestNumber) : null;
    let shouldInjectId = false;
    let injectedGuestId: string | null = null;

    if (!guestKey && state.pendingChunk) {
      guestKey = state.pendingChunk.guestKey;
    }

    if (!guestKey) {
      injectedGuestId = String(state.nextSyntheticGuestId);
      state.nextSyntheticGuestId = nextSynthetic(state.nextSyntheticGuestId);
      guestKey = buildGuestKey(injectedGuestId, null);
      shouldInjectId = true;
    }

    if (!guestKey) {
      return sequence;
    }

    const resolvedGuestKey = guestKey;
    let hostId = state.hostIdByGuestKey.get(resolvedGuestKey);
    if (!hostId) {
      hostId = this.nextHostImageId++;
      state.hostIdByGuestKey.set(resolvedGuestKey, hostId);
    }

    const mergedParams = mergeTransmitParams(state.pendingChunk?.params ?? null, transmit);
    const activeOffload = state.pendingChunk?.offload ?? null;
    const shouldOffload = activeOffload ?? this.shouldOffload(mergedParams, parsed.data, transmit.more);
    if (shouldOffload) {
      const offload = activeOffload ?? this.startOffload();
      if (!activeOffload && transmit.more) {
        state.pendingChunk = { guestKey, hostId, params: mergedParams, offload };
      }
      this.appendOffload(offload, parsed.data);
      if (!transmit.more) {
        const filePath = this.finishOffload(offload);
        const hostSequence = buildHostFileTransmitSequence(hostId, mergedParams, filePath);
        if (hostSequence.length > 0) {
          this.enqueue(hostSequence);
        }
      const hostControl = process.env.OPENMUX_PTY_TRACE
        ? parseKittySequence(hostSequence)?.control ?? ''
        : '';
      tracePtyEvent('kitty-broker-host', {
        ptyId,
        hostId,
        guestKey: resolvedGuestKey,
        offload: true,
        filePath,
        bytesWritten: offload.bytesWritten,
        control: hostControl,
        });
        void this.scheduleCleanup(filePath);
      }
    } else {
      const hostSequence = buildHostTransmitSequence(hostId, mergedParams, parsed.data);
      if (hostSequence.length > 0) {
        this.enqueue(hostSequence);
      }
      const hostControl = process.env.OPENMUX_PTY_TRACE
        ? parseKittySequence(hostSequence)?.control ?? ''
        : '';
      tracePtyEvent('kitty-broker-host', {
        ptyId,
        hostId,
        guestKey: resolvedGuestKey,
        offload: false,
        dataLen: parsed.data.length,
        control: hostControl,
      });
    }

    if (shouldInjectId && injectedGuestId) {
      parsed.params.set('i', injectedGuestId);
    }

    if (transmit.more) {
      if (!state.pendingChunk) {
        state.pendingChunk = { guestKey: resolvedGuestKey, hostId, params: mergedParams, offload: null };
      } else {
        state.pendingChunk.guestKey = resolvedGuestKey;
        state.pendingChunk.hostId = hostId;
        state.pendingChunk.params = mergedParams;
      }
    } else if (!state.pendingChunk?.offload || activeOffload) {
      state.pendingChunk = null;
    }

    let rebuiltSequence: string | null = null;
    if (shouldInjectId && injectedGuestId) {
      const rebuiltControl = rebuildControl(parsed.params);
      rebuiltSequence = `${parsed.prefix}${rebuiltControl};${parsed.data}${parsed.suffix}`;
    }

    const shouldStubSharedMemory = this.stubSharedMemory && mergedParams.medium === 's';
    if (!this.stubEmulator && !shouldStubSharedMemory) {
      return rebuiltSequence ?? sequence;
    }

    const { emuSequence, dropEmulator } = buildEmulatorSequence(
      parsed,
      mergedParams,
      resolvedGuestKey,
      state.stubbedGuestKeys,
      shouldStubSharedMemory
    );

    if (dropEmulator) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey: resolvedGuestKey,
        drop: true,
      });
      return '';
    }

    if (emuSequence) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey: resolvedGuestKey,
        stubbed: true,
      });
      return emuSequence;
    }

    return rebuiltSequence ?? sequence;
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

  private shouldOffload(params: TransmitParams, data: string, isChunked: boolean): boolean {
    if (this.offloadThresholdBytes <= 0) return false;
    const medium = params.medium ?? 'd';
    if (medium !== 'd') return false;
    if (isChunked) return true;
    if (!data) return false;
    const estimated = estimateDecodedSize(data);
    return estimated >= this.offloadThresholdBytes;
  }

  private startOffload(): OffloadState {
    const filePath = createTempFilePath(this.tempFileCounter++);
    const fd = fs.openSync(filePath, 'w');
    return { fd, filePath, carry: '', bytesWritten: 0 };
  }

  private appendOffload(offload: OffloadState, data: string): void {
    if (!data) return;
    const combined = `${offload.carry}${data}`;
    const usableLen = Math.floor(combined.length / 4) * 4;
    const toDecode = usableLen > 0 ? combined.slice(0, usableLen) : '';
    offload.carry = combined.slice(usableLen);
    if (toDecode.length === 0) return;
    const decoded = Buffer.from(toDecode, 'base64');
    if (decoded.length === 0) return;
    fs.writeSync(offload.fd, decoded);
    offload.bytesWritten += decoded.length;
  }

  private finishOffload(offload: OffloadState): string {
    if (offload.carry.length > 0) {
      const decoded = Buffer.from(offload.carry, 'base64');
      if (decoded.length > 0) {
        fs.writeSync(offload.fd, decoded);
        offload.bytesWritten += decoded.length;
      }
      offload.carry = '';
    }
    fs.closeSync(offload.fd);
    return offload.filePath;
  }

  private async abortOffload(offload: OffloadState): Promise<KittyOffloadError | void> {
    const closeResult = await errore.tryAsync<void, KittyOffloadError>({
      try: () => {
        fs.closeSync(offload.fd);
        return Promise.resolve();
      },
      catch: (e) => new KittyOffloadError({ operation: 'close', reason: String(e), cause: e }),
    });
    if (closeResult instanceof KittyOffloadError) {
      return closeResult;
    }

    const unlinkResult = await errore.tryAsync<void, KittyOffloadError>({
      try: () => {
        fs.unlinkSync(offload.filePath);
        return Promise.resolve();
      },
      catch: (e) => new KittyOffloadError({ operation: 'unlink', reason: String(e), cause: e }),
    });
    return unlinkResult;
  }

  private async scheduleCleanup(filePath: string): Promise<KittyOffloadError | void> {
    if (this.offloadCleanupDelayMs <= 0) {
      const result = await errore.tryAsync<void, KittyOffloadError>({
        try: () => {
          fs.unlinkSync(filePath);
          return Promise.resolve();
        },
        catch: (e) => new KittyOffloadError({ operation: 'cleanup', reason: String(e), cause: e }),
      });
      return result;
    }

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      void errore.tryAsync<void, KittyOffloadError>({
        try: () => {
          fs.unlinkSync(filePath);
          return Promise.resolve();
        },
        catch: (e) => new KittyOffloadError({ operation: 'cleanup', reason: String(e), cause: e }),
      });
    }, this.offloadCleanupDelayMs);
    this.cleanupTimers.add(timer);
  }

  private enqueue(chunk: string): void {
    if (!this.writer) return;
    if (this.autoFlush) {
      this.writer(chunk);
      return;
    }
    this.pendingWrites.push(chunk);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      this.flushScheduler?.();
    }
  }
}

function nextSynthetic(current: number): number {
  const next = current + 1;
  if (next > 0xffffffff) return 2147483647;
  return next;
}