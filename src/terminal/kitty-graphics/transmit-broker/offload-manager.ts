import { Buffer } from 'buffer';
import fs from 'node:fs';
import * as errore from 'errore';
import { KittyOffloadError } from '../../../effect/errors';
import { createTempFilePath, estimateDecodedSize, type TransmitParams } from '../sequence-utils';
import { resolveKittyOffloadCleanupDelay, resolveKittyOffloadThreshold } from '../offload-utils';

export type OffloadState = {
  fd: number;
  filePath: string;
  carry: string;
  bytesWritten: number;
};

/**
 * Manages offloading of large image data to temporary files.
 *
 * When image data exceeds a threshold (configurable via OPENMUX_KITTY_OFFLOAD_THRESHOLD),
 * the data is written to a temp file instead of being sent directly through the
 * PTY. The host terminal then reads from the file path (medium='f').
 *
 * Benefits:
 * - Reduces PTY data volume for large images
 * - Avoids base64 overhead for huge payloads
 * - Allows incremental chunked writes
 *
 * Temp files are cleaned up after a delay (OPENMUX_KITTY_OFFLOAD_CLEANUP_DELAY)
 * to ensure the host has time to read them.
 */
export class OffloadManager {
  private readonly offloadThresholdBytes = resolveKittyOffloadThreshold();
  private readonly offloadCleanupDelayMs = resolveKittyOffloadCleanupDelay();
  private readonly cleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  private tempFileCounter = 0;

  dispose(): void {
    for (const timer of this.cleanupTimers) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }

  /**
   * Determine if a transmission should be offloaded to a file.
   *
   * Only direct (medium='d') transmissions are considered for offload.
   * Chunked transmissions are always offloaded to handle partial data.
   *
   * @param params - Transmission parameters and data
   * @returns true if should offload to temp file
   */
  shouldOffload(params: { params: TransmitParams; data: string; isChunked: boolean }): boolean {
    const { params: transmitParams, data, isChunked } = params;
    if (this.offloadThresholdBytes <= 0) return false;

    const medium = transmitParams.medium ?? 'd';
    if (medium !== 'd') return false;
    if (isChunked) return true;
    if (!data) return false;

    const estimated = estimateDecodedSize(data);
    return estimated >= this.offloadThresholdBytes;
  }

  /**
   * Start a new offload operation.
   * Creates a temp file and returns the offload state for appending data.
   *
   * @returns OffloadState with file descriptor and path
   */
  start(): OffloadState {
    const filePath = createTempFilePath(this.tempFileCounter++);
    const fd = fs.openSync(filePath, 'w');
    return { fd, filePath, carry: '', bytesWritten: 0 };
  }

  /**
   * Append base64 data to an active offload operation.
   *
   * Data is buffered until a multiple of 4 bytes is available
   * (base64 requires 4-byte aligned input). Any remaining partial
   * bytes are carried over to the next append call.
   *
   * @param params - Offload state and base64 data to append
   */
  append(params: { offload: OffloadState; data: string }): void {
    const { offload, data } = params;
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

  /**
   * Finish an offload operation.
   *
   * Writes any remaining carried bytes, closes the file descriptor,
   * and returns the temp file path for the host transmission.
   *
   * @param offload - Active offload state
   * @returns Path to the temp file containing decoded image data
   */
  finish(offload: OffloadState): string {
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

  async abort(offload: OffloadState): Promise<KittyOffloadError | void> {
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

    return this.unlinkFile({ filePath: offload.filePath, operation: 'unlink' });
  }

  async scheduleCleanup(filePath: string): Promise<KittyOffloadError | void> {
    if (this.offloadCleanupDelayMs <= 0) {
      return this.unlinkFile({ filePath, operation: 'cleanup' });
    }

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(timer);
      void this.unlinkFile({ filePath, operation: 'cleanup' });
    }, this.offloadCleanupDelayMs);
    this.cleanupTimers.add(timer);
  }

  private async unlinkFile(params: {
    filePath: string;
    operation: 'unlink' | 'cleanup';
  }): Promise<KittyOffloadError | void> {
    const { filePath, operation } = params;
    return errore.tryAsync<void, KittyOffloadError>({
      try: () => {
        fs.unlinkSync(filePath);
        return Promise.resolve();
      },
      catch: (e) => new KittyOffloadError({ operation, reason: String(e), cause: e }),
    });
  }
}
