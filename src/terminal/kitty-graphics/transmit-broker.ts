import { getHostCapabilities } from '../capabilities';
import type { KittyGraphicsImageInfo } from '../emulator-interface';
import { tracePtyEvent } from '../pty-trace';
import { buildDeleteImage } from './commands';
import { mergeTransmitParams, type KittySequence, type TransmitParams } from './sequence-utils';
import type { RendererLike } from './types';
import {
  buildEmulatorSequence,
  buildHostFileTransmitSequence,
  buildHostTransmitSequence,
} from './transmit-broker/sequences';
import { IdMapper } from './transmit-broker/id-mapper';
import { OffloadManager } from './transmit-broker/offload-manager';
import type { OffloadState } from './transmit-broker/offload-manager';
import { SequenceParser } from './transmit-broker/sequence-parser';
import type { DeleteRequest, TransmitRequest } from './transmit-broker/sequence-parser';

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
  private readonly idMapper = new IdMapper();
  private readonly offloadManager = new OffloadManager();
  private readonly sequenceParser = new SequenceParser();
  private pendingWrites: string[] = [];
  private autoFlush = true;
  private flushScheduled = false;
  private flushScheduler: (() => void) | null = null;
  /**
   * Whether to stub the emulator entirely for Kitty graphics.
   *
   * When enabled, sequences are rewritten to remove data payloads
   * before reaching the emulator, keeping only control parameters.
   * This creates "stubbed" images that track placement without
   * storing actual pixel data in the emulator.
   *
   * CRITICAL for performance: without stubbing, the native VT
   * parser processes the full base64 payload character-by-character,
   * which takes 20-30ms per 1.5MB frame — making 60FPS Kitty apps
   * (like OpenTUI's golden star / texture loading demos) impossible.
   * With stubbing, the emulator only sees ~100 bytes of control params.
   *
   * The broker still enqueues the full sequence for the host terminal,
   * so the image is still displayed — the emulator just doesn't need
   * the pixel data since rendering is delegated to KittyGraphicsRenderer.
   *
   * Controlled by OPENMUX_KITTY_EMULATOR_STUB environment variable.
   * Default: enabled (stub all Kitty transmit data to the emulator).
   */
  private stubEmulator = true;
  /**
   * Whether to stub shared memory (medium='s') transmissions.
   *
   * Shared memory transmission requires the terminal emulator to access
   * shared memory segments created by the application. In multiplexer
   * environments, this is problematic because:
   *
   * 1. The emulator runs in a different process from the PTY
   * 2. Shared memory segments are process-scoped and may not be accessible
   * 3. Cross-platform shared memory handling adds complexity
   *
   * When stubbing is enabled (default), shared memory transmissions are
   * intercepted and converted to regular data transmissions that the
   * emulator can process normally. The dimensions are preserved, but
   * the actual pixel data path changes.
   *
   * Controlled by OPENMUX_KITTY_STUB_SHARED_MEMORY:
   * - '0', 'false' → Disable stubbing (pass through shared memory refs)
   * - Default → Enable stubbing (convert to regular transmissions)
   *
   * Disabling stubbing requires the emulator to handle shared memory
   * references directly, which may not work in all environments.
   */
  private stubSharedMemory = true;

  constructor() {
    const stubEnv = (process.env.OPENMUX_KITTY_EMULATOR_STUB ?? '').toLowerCase();
    this.stubEmulator = !(stubEnv === '0' || stubEnv === 'false');
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
    this.idMapper.dispose();
    this.offloadManager.dispose();
    this.writer = null;
    this.pendingWrites = [];
    this.flushScheduled = false;
    this.flushScheduler = null;
  }

  /**
   * Clear all state for a PTY when it closes.
   *
   * Removes ID mappings, clears pending chunks, and aborts
   * any active offload operations for the PTY.
   *
   * @param ptyId - PTY identifier to clear
   */
  clearPty(ptyId: string): void {
    const pendingChunk = this.idMapper.clearPty(ptyId);
    if (pendingChunk?.offload) {
      void this.offloadManager.abort(pendingChunk.offload);
    }
  }

  /**
   * Resolve the host image ID for an existing guest image.
   *
   * Used by the renderer to determine if a placed image
   * exists and what its host ID is.
   *
   * @param ptyId - PTY identifier
   * @param info - Guest image info with id and/or number
   * @returns Host image ID if mapped, null otherwise
   */
  resolveHostId(ptyId: string, info: KittyGraphicsImageInfo): number | null {
    return this.idMapper.resolveHostId(ptyId, info);
  }

  dropMapping(ptyId: string, info: KittyGraphicsImageInfo): void {
    this.idMapper.dropMapping(ptyId, info);
  }

  /**
   * Main entry point for handling Kitty graphics sequences.
   *
   * Processing flow:
   * 1. Parse the sequence into structured parameters
   * 2. Handle delete actions (a=d) separately
   * 3. Resolve transmit target (guest key → host ID mapping)
   * 4. Determine if data should be offloaded to temp file
   * 5. Forward to host terminal with resolved parameters
   * 6. Rebuild guest sequence for emulator (possibly stubbed)
   *
   * @param ptyId - PTY identifier for this sequence
   * @param sequence - Raw Kitty graphics escape sequence
   * @returns Modified sequence for the emulator, or empty string to drop
   */
  handleSequence(ptyId: string, sequence: string): string {
    if (!this.enabled || !this.writer) return sequence;

    const parsed = this.sequenceParser.parse(sequence);
    if (!parsed) return sequence;

    const action = parsed.params.get('a');
    if (action === 'd') {
      const deleteRequest = this.sequenceParser.resolveDelete(parsed);
      if (deleteRequest) {
        return this.handleDelete({ ptyId, sequence, deleteRequest });
      }
      return sequence;
    }

    this.traceGuestSequence({ ptyId, parsed });

    const pendingChunk = this.idMapper.getPendingChunk(ptyId);
    const transmit = this.sequenceParser.resolveTransmit({ parsed, pendingChunk });
    if (!transmit) return sequence;

    const target = this.idMapper.resolveTransmitTarget({
      ptyId,
      guestId: transmit.guestId,
      guestNumber: transmit.guestNumber,
      fallbackGuestKey: transmit.fallbackGuestKey,
    });
    if (!target) return sequence;

    const mergedParams = mergeTransmitParams(pendingChunk?.params ?? null, transmit.params);
    const activeOffload = pendingChunk?.offload ?? null;
    const shouldOffload =
      activeOffload !== null ||
      this.offloadManager.shouldOffload({
        params: mergedParams,
        data: parsed.data,
        isChunked: transmit.params.more,
      });

    const pendingOffload = this.forwardHostTransmit({
      ptyId,
      parsed,
      targetHostId: target.hostId,
      guestKey: target.guestKey,
      params: mergedParams,
      transmit,
      activeOffload,
      shouldOffload,
    });

    const rebuiltSequence = target.injectedGuestId
      ? this.sequenceParser.injectGuestId({
          parsed,
          injectedGuestId: target.injectedGuestId,
        })
      : null;

    this.updatePendingChunk({
      ptyId,
      guestKey: target.guestKey,
      hostId: target.hostId,
      params: mergedParams,
      more: transmit.params.more,
      offload: pendingOffload,
    });

    const shouldStubSharedMemory = this.stubSharedMemory && mergedParams.medium === 's';
    if (!this.stubEmulator && !shouldStubSharedMemory) {
      return rebuiltSequence ?? sequence;
    }

    const stubbedGuestKeys = this.idMapper.getStubbedGuestKeys(ptyId);
    const { emuSequence, dropEmulator } = buildEmulatorSequence(
      parsed,
      mergedParams,
      target.guestKey,
      stubbedGuestKeys,
      shouldStubSharedMemory
    );

    if (dropEmulator) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey: target.guestKey,
        drop: true,
      });
      return '';
    }

    if (emuSequence) {
      tracePtyEvent('kitty-broker-emu', {
        ptyId,
        guestKey: target.guestKey,
        stubbed: true,
      });
      return emuSequence;
    }

    return rebuiltSequence ?? sequence;
  }

  private handleDelete(params: {
    ptyId: string;
    sequence: string;
    deleteRequest: DeleteRequest;
  }): string {
    const { ptyId, sequence, deleteRequest } = params;

    if (deleteRequest.target === 'all') {
      const pendingChunk = this.idMapper.getPendingChunk(ptyId);
      this.idMapper.setPendingChunk(ptyId, null);
      if (pendingChunk?.offload) {
        void this.offloadManager.abort(pendingChunk.offload);
      }

      // Host renders are driven by the emulator state; forwarding d=a would
      // nuke images from unrelated screens/panes.
      return sequence;
    }

    if (!deleteRequest.guestKey) {
      return sequence;
    }

    const hostId = this.idMapper.deleteGuestKey(ptyId, deleteRequest.guestKey);
    if (hostId) {
      this.enqueue(buildDeleteImage(hostId));
    }

    return sequence;
  }

  private forwardHostTransmit(params: {
    ptyId: string;
    parsed: KittySequence;
    targetHostId: number;
    guestKey: string;
    params: TransmitParams;
    transmit: TransmitRequest;
    activeOffload: OffloadState | null;
    shouldOffload: boolean;
  }): OffloadState | null {
    const {
      ptyId,
      parsed,
      targetHostId,
      guestKey,
      params: mergedParams,
      transmit,
      activeOffload,
      shouldOffload,
    } = params;

    if (shouldOffload) {
      const offload = activeOffload ?? this.offloadManager.start();
      this.offloadManager.append({ offload, data: parsed.data });

      if (!transmit.params.more) {
        const filePath = this.offloadManager.finish(offload);
        const hostSequence = buildHostFileTransmitSequence(targetHostId, mergedParams, filePath);
        if (hostSequence.length > 0) {
          this.enqueue(hostSequence);
        }
        tracePtyEvent('kitty-broker-host', {
          ptyId,
          hostId: targetHostId,
          guestKey,
          offload: true,
          filePath,
          bytesWritten: offload.bytesWritten,
          control: this.getTraceControl(hostSequence),
        });
        void this.offloadManager.scheduleCleanup(filePath);
        return null;
      }

      return offload;
    }

    const hostSequence = buildHostTransmitSequence(targetHostId, mergedParams, parsed.data);
    if (hostSequence.length > 0) {
      this.enqueue(hostSequence);
    }
    tracePtyEvent('kitty-broker-host', {
      ptyId,
      hostId: targetHostId,
      guestKey,
      offload: false,
      dataLen: parsed.data.length,
      control: this.getTraceControl(hostSequence),
    });
    return null;
  }

  private updatePendingChunk(params: {
    ptyId: string;
    guestKey: string;
    hostId: number;
    params: TransmitParams;
    more: boolean;
    offload: OffloadState | null;
  }): void {
    const { ptyId, guestKey, hostId, params: transmitParams, more, offload } = params;

    if (!more) {
      this.idMapper.setPendingChunk(ptyId, null);
      return;
    }

    this.idMapper.setPendingChunk(ptyId, {
      guestKey,
      hostId,
      params: transmitParams,
      offload,
    });
  }

  private traceGuestSequence(params: { ptyId: string; parsed: KittySequence }): void {
    const { ptyId, parsed } = params;
    tracePtyEvent('kitty-broker-seq', {
      ptyId,
      control: parsed.control,
      dataLen: parsed.data.length,
      action: parsed.params.get('a') ?? '',
      format: parsed.params.get('f') ?? '',
      medium: parsed.params.get('t') ?? '',
      more: parsed.params.get('m') ?? '',
      imageId: parsed.params.get('i') ?? '',
      imageNumber: parsed.params.get('I') ?? '',
    });
  }

  private getTraceControl(sequence: string): string {
    if (!process.env.OPENMUX_PTY_TRACE) return '';
    return this.sequenceParser.parse(sequence)?.control ?? '';
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
