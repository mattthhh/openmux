/**
 * Suspended session PTY metadata cache.
 *
 * Non-active session PTYs are suspended (kept alive but unsubscribed from
 * rendering). Their live metadata (foreground process, shell, title, cwd)
 * becomes stale because the aggregate view only loads disk snapshots.
 *
 * This cache follows the same pattern as GitMetadataCache:
 * - Fetches live metadata per PTY from the PTY service
 * - Deduplicates in-flight requests
 * - TTL-based expiration
 * - Invalidated by subscription events (title/process/lifecycle changes)
 */

import type { PtyMetadata } from '../../../effect/bridge/aggregate';
import { getPtyMetadata } from '../../../effect/bridge/aggregate';
import { getAggregateSessionPtyMapping } from '../../../effect/bridge/aggregate';

export interface SuspendedPtyData {
  /** The real PTY ID (not the synthetic saved: one) */
  ptyId: string;
  /** Fetched metadata */
  metadata: PtyMetadata;
  /** When this entry was cached */
  lastUpdated: number;
}

interface SuspendedPtyCacheOptions {
  ttlMs?: number;
  batchSize?: number;
}

export class SuspendedPtyCache {
  private cache = new Map<string, SuspendedPtyData>();
  /** Reverse index: real ptyId -> cache key */
  private ptyIdToKey = new Map<string, string>();
  private inFlight = new Map<string, Promise<SuspendedPtyData | null>>();
  private readonly ttlMs: number;
  private readonly batchSize: number;

  constructor(options: SuspendedPtyCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 8000;
    this.batchSize = options.batchSize ?? 8;
  }

  /**
   * Fetch live PTY metadata for every pane in a non-active session.
   *
   * Returns a map of paneId -> SuspendedPtyData for PTYs that are still alive.
   * Defunct PTYs are omitted (caller falls back to disk snapshot).
   */
  async getSessionPtys(sessionId: string): Promise<Map<string, SuspendedPtyData>> {
    const mapping = await getAggregateSessionPtyMapping(sessionId);
    if (!mapping || !mapping.mapping || mapping.mapping.size === 0) {
      return new Map();
    }

    const results = new Map<string, SuspendedPtyData>();
    const toFetch: Array<{ paneId: string; ptyId: string }> = [];
    const now = Date.now();

    for (const [paneId, ptyId] of mapping.mapping) {
      const key = cacheKey(sessionId, paneId);
      const cached = this.cache.get(key);
      if (cached && now - cached.lastUpdated <= this.ttlMs) {
        results.set(paneId, cached);
        continue;
      }

      // Skip stale pane IDs from the mapping
      if (mapping.stalePaneIds?.includes(paneId)) {
        this.cache.delete(key);
        this.ptyIdToKey.delete(ptyId);
        continue;
      }

      toFetch.push({ paneId, ptyId });
    }

    if (toFetch.length === 0) {
      return results;
    }

    for (let i = 0; i < toFetch.length; i += this.batchSize) {
      const batch = toFetch.slice(i, i + this.batchSize);
      const batchResults = await Promise.all(
        batch.map(async ({ paneId, ptyId }) => {
          const result = await this.fetchSingle(sessionId, paneId, ptyId);
          return result ? ({ paneId, data: result } as const) : null;
        })
      );

      for (const item of batchResults) {
        if (!item) continue;
        results.set(item.paneId, item.data);
      }
    }

    return results;
  }

  /** Pre-load metadata for a batch of sessions (parallel). */
  async preloadSessions(sessionIds: string[]): Promise<Map<string, Map<string, SuspendedPtyData>>> {
    const entries = await Promise.all(
      sessionIds.map(async (sessionId) => {
        const ptys = await this.getSessionPtys(sessionId);
        return [sessionId, ptys] as const;
      })
    );

    return new Map(entries);
  }

  /** Invalidate a single PTY by its real PTY ID (from subscription events). */
  invalidateByPtyId(ptyId: string): void {
    const key = this.ptyIdToKey.get(ptyId);
    if (key) {
      this.cache.delete(key);
      this.ptyIdToKey.delete(ptyId);
    }
  }

  /** Invalidate all entries for a session (e.g. after session switch). */
  invalidateSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, data] of this.cache) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.ptyIdToKey.delete(data.ptyId);
      }
    }
  }

  /** Clear everything (e.g. on aggregate view close). */
  clear(): void {
    this.cache.clear();
    this.ptyIdToKey.clear();
    this.inFlight.clear();
  }

  private async fetchSingle(
    sessionId: string,
    paneId: string,
    ptyId: string
  ): Promise<SuspendedPtyData | null> {
    const key = cacheKey(sessionId, paneId);
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = (async (): Promise<SuspendedPtyData | null> => {
      try {
        const result = await getPtyMetadata(ptyId, { skipGitDiffStats: true });
        if (result instanceof Error || !result) {
          // PTY defunct or not found — remove from cache
          this.cache.delete(key);
          this.ptyIdToKey.delete(ptyId);
          return null;
        }

        const entry: SuspendedPtyData = {
          ptyId,
          metadata: result,
          lastUpdated: Date.now(),
        };

        this.cache.set(key, entry);
        this.ptyIdToKey.set(ptyId, key);
        return entry;
      } catch (e) {
        console.warn(`[SuspendedPtyCache] Failed to fetch metadata for ${ptyId}:`, e);
        this.cache.delete(key);
        this.ptyIdToKey.delete(ptyId);
        return null;
      }
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }
}

function cacheKey(sessionId: string, paneId: string): string {
  return `${sessionId}\u0000${paneId}`;
}

export function createSuspendedPtyCache(options?: SuspendedPtyCacheOptions): SuspendedPtyCache {
  return new SuspendedPtyCache(options);
}
