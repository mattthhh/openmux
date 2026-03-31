/**
 * Session-PTY Cache
 * Simple in-memory cache for session→PTY mappings with expiration
 */

import type { PtyId, SessionId } from '../../../types';
import type { SessionPtyCacheEntry } from '../types';

/** Helper to convert string to PtyId branded type */
export const asPtyId = (id: string): PtyId => id as PtyId;

/** Default cache expiration time in milliseconds */
export const DEFAULT_CACHE_MAX_AGE_MS = 30000;

/** Simple in-memory cache for session→PTY mappings */
export class SessionPtyCache {
  private cache = new Map<SessionId, SessionPtyCacheEntry>();
  private ptyToSession = new Map<PtyId, SessionId>();
  private maxAgeMs: number;

  constructor(maxAgeMs = DEFAULT_CACHE_MAX_AGE_MS) {
    this.maxAgeMs = maxAgeMs;
  }

  /** Get cached entry for a session */
  get(sessionId: SessionId): SessionPtyCacheEntry | undefined {
    const entry = this.cache.get(sessionId);
    if (!entry) return undefined;

    // Check expiration
    if (Date.now() - entry.lastUpdated > this.maxAgeMs) {
      this.delete(sessionId);
      return undefined;
    }

    return entry;
  }

  /** Set cache entry for a session */
  set(sessionId: SessionId, ptyIds: PtyId[], isLoaded: boolean): void {
    // Remove old mappings
    const oldEntry = this.cache.get(sessionId);
    if (oldEntry) {
      for (const ptyId of oldEntry.ptyIds) {
        this.ptyToSession.delete(ptyId);
      }
    }

    // Add new mappings
    const newEntry: SessionPtyCacheEntry = {
      sessionId,
      ptyIds: new Set(ptyIds),
      lastUpdated: Date.now(),
      isLoaded,
    };

    this.cache.set(sessionId, newEntry);
    for (const ptyId of ptyIds) {
      this.ptyToSession.set(ptyId, sessionId);
    }
  }

  /** Get session ID for a PTY */
  getSessionForPty(ptyId: PtyId): SessionId | undefined {
    return this.ptyToSession.get(ptyId);
  }

  /** Delete cache entry */
  delete(sessionId: SessionId): void {
    const entry = this.cache.get(sessionId);
    if (entry) {
      for (const ptyId of entry.ptyIds) {
        this.ptyToSession.delete(ptyId);
      }
      this.cache.delete(sessionId);
    }
  }

  /** Clear all cached entries */
  clear(): void {
    this.cache.clear();
    this.ptyToSession.clear();
  }

  /** Get all cached session IDs */
  keys(): IterableIterator<SessionId> {
    return this.cache.keys();
  }
}

/** Global cache instance */
export const sessionPtyCache = new SessionPtyCache();

/** Aggregate-local session pane↔PTY mappings for background-loaded sessions */
export const aggregateSessionMappings = new Map<string, Map<string, string>>();

/** Clear both the main cache and aggregate mappings */
export function clearAllCaches(): void {
  sessionPtyCache.clear();
  aggregateSessionMappings.clear();
}

/** Invalidate cache for a specific session */
export function invalidateSessionCache(sessionId: string): void {
  sessionPtyCache.delete(sessionId as SessionId);
  aggregateSessionMappings.delete(sessionId);
}

/** Remove aggregate-local mappings that point at a destroyed PTY */
export function removeAggregateSessionMappingForPty(ptyId: string): void {
  for (const [sessionId, mapping] of aggregateSessionMappings) {
    const nextMapping = new Map([...mapping].filter(([, mappedPtyId]) => mappedPtyId !== ptyId));

    if (nextMapping.size === mapping.size) {
      continue;
    }

    if (nextMapping.size === 0) {
      aggregateSessionMappings.delete(sessionId);
      continue;
    }

    aggregateSessionMappings.set(sessionId, nextMapping);
  }
}
