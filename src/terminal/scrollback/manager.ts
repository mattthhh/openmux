/**
 * ScrollbackArchiveManager - Manages multiple scrollback archives with global limits.
 * Provides coordination for memory management across all PTY sessions.
 */

import { SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL } from '../scrollback-config';
/** Minimal contract for a scrollback archive, breaking circular dep with archive.ts */
export interface ScrollbackArchiveLike {
  readonly bytes: number;
  getOldestChunk(): ArchiveChunk | null;
  dropOldestChunk(): DropChunkResult | null;
}

import type { ArchiveChunk, DropChunkResult } from './types';

/**
 * Manages multiple scrollback archives with a global byte limit.
 * Ensures total memory usage stays within configured bounds.
 */
export class ScrollbackArchiveManager {
  private archives = new Set<ScrollbackArchiveLike>();
  private readonly maxBytes: number;

  constructor(maxBytes?: number) {
    this.maxBytes = maxBytes ?? SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL;
  }

  /**
   * Registers an archive with this manager.
   * The manager will track this archive for global limit enforcement.
   * @param archive - Archive to register
   */
  register(archive: ScrollbackArchiveLike): void {
    this.archives.add(archive);
  }

  /**
   * Unregisters an archive from this manager.
   * Called when an archive is disposed.
   * @param archive - Archive to unregister
   */
  unregister(archive: ScrollbackArchiveLike): void {
    this.archives.delete(archive);
  }

  /**
   * Enforces the global byte limit across all registered archives.
   * Drops oldest chunks from oldest archives until the limit is satisfied.
   */
  enforceGlobalLimit(): void {
    let totalBytes = 0;
    for (const archive of this.archives) {
      totalBytes += archive.bytes;
    }

    while (totalBytes > this.maxBytes) {
      let targetArchive: ScrollbackArchiveLike | null = null;
      let targetChunk: ArchiveChunk | null = null;

      // Find the oldest chunk across all archives
      for (const archive of this.archives) {
        const chunk = archive.getOldestChunk();
        if (!chunk) continue;
        if (!targetChunk || chunk.createdAt < targetChunk.createdAt) {
          targetChunk = chunk;
          targetArchive = archive;
        }
      }

      if (!targetArchive || !targetChunk) break;

      const removed = targetArchive.dropOldestChunk();
      if (!removed) break;
      totalBytes -= removed.bytesRemoved;
    }
  }

  /**
   * Gets the total bytes used by all registered archives.
   * @returns Total bytes
   */
  getTotalBytes(): number {
    let total = 0;
    for (const archive of this.archives) {
      total += archive.bytes;
    }
    return total;
  }

  /**
   * Gets the number of registered archives.
   * @returns Archive count
   */
  getArchiveCount(): number {
    return this.archives.size;
  }
}
