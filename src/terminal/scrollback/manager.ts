/**
 * ScrollbackArchiveManager - Manages multiple scrollback archives with global limits.
 * Provides coordination for memory management across all PTY sessions.
 */

import fs from 'node:fs';
import path from 'node:path';
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
  private readonly rootDir?: string;

  constructor(maxBytes?: number, rootDir?: string) {
    this.maxBytes = maxBytes ?? SCROLLBACK_ARCHIVE_MAX_BYTES_GLOBAL;
    this.rootDir = rootDir;
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

  /**
   * Garbage-collect stale scrollback directories from previous runs.
   *
   * After a PTY exits, its archive directory is removed asynchronously.
   * If the process is killed (SIGKILL, power loss) before cleanup runs,
   * the directory stays on disk forever. This method discovers and removes
   * those orphaned directories.
   *
   * Strategy: scan the scrollback root for `pty-*` directories. Any whose
   * PTY ID is NOT in the live `activePtyIds` set is stale (from a previous
   * process run) and gets removed.
   *
   * Throttling: directories are removed in batches with a yield between
   * each batch to avoid saturating the event loop or disk I/O at startup.
   *
   * @param activePtyIds - Set of currently live PTY IDs (whose archives are in use)
   * @param batchSize - Number of directories to remove per batch (default 16)
   * @param batchDelayMs - Milliseconds to yield between batches (default 100)
   * @returns Number of directories removed
   */
  async gcStaleDirectories(
    activePtyIds: Set<string>,
    batchSize = 16,
    batchDelayMs = 100
  ): Promise<number> {
    if (!this.rootDir) return 0;

    let entries: string[];
    try {
      entries = fs.readdirSync(this.rootDir);
    } catch {
      return 0;
    }

    const staleDirs: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('pty-')) continue;
      // Extract ptyId from directory name: "pty-<id>" → "<id>"
      const ptyId = entry.slice('pty-'.length);
      if (!ptyId) continue;
      if (activePtyIds.has(ptyId)) continue;
      staleDirs.push(entry);
    }

    if (staleDirs.length === 0) return 0;

    let removed = 0;
    const { default: fsp } = await import('node:fs/promises');

    for (let i = 0; i < staleDirs.length; i += batchSize) {
      const batch = staleDirs.slice(i, i + batchSize);
      await Promise.all(
        batch.map((dir) =>
          fsp.rm(path.join(this.rootDir!, dir), { recursive: true, force: true }).then(
            () => {
              removed++;
            },
            () => {
              // Already gone or inaccessible — skip.
            }
          )
        )
      );

      // Yield between batches so we don't block the event loop.
      const remaining = staleDirs.length - (i + batchSize);
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    return removed;
  }
}
