/**
 * Centralized git metadata cache for stable, batched updates.
 *
 * Key features:
 * - Repo-level caching: All PTYs in the same repo share one metadata object
 * - Reference equality: Unchanged repos return the same object reference
 * - Batched updates: All PTYs in a repo update together atomically
 * - Debounced diff stats: Expensive git diff operations are debounced
 * - No flickering: Metadata is never cleared, only updated with new values
 */

import type { GitInfo, GitDiffStats } from '../effect/services/pty/helpers';

/** Git metadata for a repository - shared by all PTYs in that repo */
export interface GitRepoMetadata {
  /** Unique key for the repo (workDir or gitDir) */
  repoKey: string;
  /** Current branch name */
  branch: string | undefined;
  /** Whether working directory has changes */
  dirty: boolean;
  /** Number of staged files */
  staged: number;
  /** Number of unstaged files */
  unstaged: number;
  /** Number of untracked files */
  untracked: number;
  /** Number of conflicted files */
  conflicted: number;
  /** Commits ahead of upstream */
  ahead: number | undefined;
  /** Commits behind upstream */
  behind: number | undefined;
  /** Number of stashes */
  stashCount: number | undefined;
  /** Repository state (rebasing, merging, etc.) */
  state: GitInfo['state'] | undefined;
  /** Whether HEAD is detached */
  detached: boolean;
  /** Diff statistics (debounced, may be undefined while loading) */
  diffStats: GitDiffStats | undefined;
  /** When this metadata was last updated */
  lastUpdated: number;
}

/** Pending diff stats request for debouncing */
interface PendingDiffRequest {
  promise: Promise<GitDiffStats | undefined>;
  timeout: ReturnType<typeof setTimeout>;
}

/** In-flight request for deduplication */
interface InFlightRequest {
  promise: Promise<GitRepoMetadata | undefined>;
}

/** Cache entry with metadata and watchers */
interface CacheEntry {
  metadata: GitRepoMetadata;
  pendingDiff: PendingDiffRequest | undefined;
}

/** Options for getting/setting metadata */
interface GetMetadataOptions {
  /** Skip fetching diff stats (useful for polling) */
  skipDiffStats?: boolean;
}

/** Function type for fetching git info */
type FetchGitInfoFn = (cwd: string) => Promise<GitInfo | undefined>;

/** Function type for fetching git diff stats */
type FetchDiffStatsFn = (cwd: string) => Promise<GitDiffStats | undefined>;

/**
 * Centralized cache for git metadata.
 *
 * Ensures that:
 * 1. All PTYs in the same repo share identical metadata objects (reference equality)
 * 2. Updates are atomic - all PTYs in a repo see changes at the same time
 * 3. No flickering - metadata is never cleared, only replaced with new values
 * 4. Efficient diff stats - debounced and shared across PTYs
 */
export class GitMetadataCache {
  private cache = new Map<string, CacheEntry>();
  private cwdToRepoKey = new Map<string, string>();
  private inFlight = new Map<string, InFlightRequest>();
  private fetchGitInfo: FetchGitInfoFn;
  private fetchDiffStats: FetchDiffStatsFn;
  private diffDebounceMs: number;

  constructor(options: {
    fetchGitInfo: FetchGitInfoFn;
    fetchDiffStats: FetchDiffStatsFn;
    diffDebounceMs?: number;
  }) {
    this.fetchGitInfo = options.fetchGitInfo;
    this.fetchDiffStats = options.fetchDiffStats;
    this.diffDebounceMs = options.diffDebounceMs ?? 300;
  }

  /**
   * Get metadata for a PTY's working directory.
   * Returns cached metadata if available and fresh, fetches new data if needed.
   *
   * Uses reference equality: if repo hasn't changed, returns the exact same object.
   */
  async getMetadata(
    cwd: string,
    options: GetMetadataOptions = {}
  ): Promise<GitRepoMetadata | undefined> {
    const cachedKey = this.cwdToRepoKey.get(cwd);
    const cachedEntry = cachedKey ? this.cache.get(cachedKey) : undefined;

    // If we have cached metadata and aren't forcing refresh, return it
    if (cachedEntry && !this.isStale(cachedEntry)) {
      // Trigger background diff stats update if needed
      if (!options.skipDiffStats && cachedEntry.metadata.diffStats === undefined) {
        this.scheduleDiffStatsUpdate(cwd, cachedKey!);
      }
      return cachedEntry.metadata;
    }

    // Check for in-flight request to dedupe
    const inFlight = this.inFlight.get(cwd);
    if (inFlight) {
      return inFlight.promise;
    }

    // Fetch fresh metadata
    const promise = this.fetchMetadata(cwd, options);
    this.inFlight.set(cwd, { promise });

    try {
      const result = await promise;
      return result;
    } finally {
      this.inFlight.delete(cwd);
    }
  }

  /**
   * Get metadata for multiple PTYs in a single batch operation.
   * Groups by repo key to minimize git operations.
   *
   * Returns a map of cwd -> metadata for each PTY.
   */
  async getMetadataBatch(
    cwds: string[],
    options: GetMetadataOptions = {}
  ): Promise<Map<string, GitRepoMetadata>> {
    const results = new Map<string, GitRepoMetadata>();

    // Deduplicate CWDs
    const uniqueCwds = [...new Set(cwds)];

    // First pass: resolve all CWDs to repo keys and group
    const repoKeyToCwds = new Map<string, string[]>();
    const unresolvedCwds: string[] = [];

    for (const cwd of uniqueCwds) {
      const repoKey = this.cwdToRepoKey.get(cwd);
      if (repoKey) {
        // We know this CWD's repo - add to group
        const group = repoKeyToCwds.get(repoKey);
        if (group) {
          group.push(cwd);
        } else {
          repoKeyToCwds.set(repoKey, [cwd]);
        }
      } else {
        // Unknown CWD - need to resolve
        unresolvedCwds.push(cwd);
      }
    }

    // Second pass: fetch for unresolved CWDs (this populates cwdToRepoKey)
    // Process in parallel but each will update the mappings
    await Promise.all(
      unresolvedCwds.map(async (cwd) => {
        const metadata = await this.getMetadata(cwd, options);
        if (metadata) {
          results.set(cwd, metadata);
          // Now add to the appropriate group for result distribution
          const repoKey = metadata.repoKey;
          const group = repoKeyToCwds.get(repoKey);
          if (group) {
            group.push(cwd);
          } else {
            repoKeyToCwds.set(repoKey, [cwd]);
          }
        }
      })
    );

    // Third pass: distribute results to all CWDs in each repo group
    for (const [repoKey, groupCwds] of repoKeyToCwds) {
      const entry = this.cache.get(repoKey);
      if (entry) {
        for (const cwd of groupCwds) {
          results.set(cwd, entry.metadata);
        }
      }
    }

    return results;
  }

  /**
   * Force refresh metadata for a specific repo.
   * Called when file watchers detect changes.
   */
  async refreshRepo(repoKey: string): Promise<GitRepoMetadata | undefined> {
    const entry = this.cache.get(repoKey);
    if (!entry) return undefined;

    // Find a CWD for this repo
    let cwd: string | undefined;
    for (const [c, key] of this.cwdToRepoKey) {
      if (key === repoKey) {
        cwd = c;
        break;
      }
    }
    if (!cwd) return entry.metadata;

    return this.fetchMetadata(cwd, { skipDiffStats: false });
  }

  /**
   * Get the repo key for a CWD.
   */
  getRepoKey(cwd: string): string | undefined {
    return this.cwdToRepoKey.get(cwd);
  }

  /**
   * Check if a CWD is in a known repo.
   */
  hasRepo(cwd: string): boolean {
    const key = this.cwdToRepoKey.get(cwd);
    return key ? this.cache.has(key) : false;
  }

  /**
   * Clear all cached data.
   */
  clear(): void {
    this.cache.clear();
    this.cwdToRepoKey.clear();
    this.inFlight.clear();
  }

  /**
   * Check if cached entry is stale and should be refreshed.
   */
  private isStale(entry: CacheEntry): boolean {
    // Consider stale after 2 seconds (matches original TTL)
    const STALE_MS = 2000;
    return Date.now() - entry.metadata.lastUpdated > STALE_MS;
  }

  /**
   * Fetch fresh metadata for a CWD.
   */
  private async fetchMetadata(
    cwd: string,
    options: GetMetadataOptions
  ): Promise<GitRepoMetadata | undefined> {
    const gitInfo = await this.fetchGitInfo(cwd);
    if (!gitInfo) {
      // Not a git repo - clear any cached mapping
      const oldKey = this.cwdToRepoKey.get(cwd);
      if (oldKey) {
        this.cwdToRepoKey.delete(cwd);
      }
      return undefined;
    }

    const repoKey = gitInfo.repoKey;
    const now = Date.now();

    // Build new metadata object
    const newMetadata: GitRepoMetadata = {
      repoKey,
      branch: gitInfo.branch,
      dirty: gitInfo.dirty,
      staged: gitInfo.staged,
      unstaged: gitInfo.unstaged,
      untracked: gitInfo.untracked,
      conflicted: gitInfo.conflicted,
      ahead: gitInfo.ahead,
      behind: gitInfo.behind,
      stashCount: gitInfo.stashCount,
      state: gitInfo.state,
      detached: gitInfo.detached,
      diffStats: undefined, // Will be populated separately
      lastUpdated: now,
    };

    // Check if we can preserve existing diff stats
    const existingEntry = this.cache.get(repoKey);
    if (existingEntry) {
      // Preserve existing diff stats if repo hasn't changed
      const existing = existingEntry.metadata;
      const repoUnchanged =
        existing.branch === newMetadata.branch &&
        existing.dirty === newMetadata.dirty &&
        existing.staged === newMetadata.staged &&
        existing.unstaged === newMetadata.unstaged &&
        existing.untracked === newMetadata.untracked &&
        existing.conflicted === newMetadata.conflicted;

      if (repoUnchanged) {
        newMetadata.diffStats = existing.diffStats;
      }
    }

    // Update cache
    const entry: CacheEntry = {
      metadata: newMetadata,
      pendingDiff: existingEntry?.pendingDiff,
    };
    this.cache.set(repoKey, entry);
    this.cwdToRepoKey.set(cwd, repoKey);

    // Schedule diff stats fetch if needed
    if (!options.skipDiffStats && newMetadata.diffStats === undefined) {
      this.scheduleDiffStatsUpdate(cwd, repoKey);
    }

    return newMetadata;
  }

  /**
   * Schedule a debounced diff stats update.
   */
  private scheduleDiffStatsUpdate(cwd: string, repoKey: string): void {
    const entry = this.cache.get(repoKey);
    if (!entry) return;

    // Cancel existing pending request
    if (entry.pendingDiff) {
      clearTimeout(entry.pendingDiff.timeout);
    }

    // Schedule new request
    const timeout = setTimeout(() => {
      void this.executeDiffStatsUpdate(cwd, repoKey);
    }, this.diffDebounceMs);

    entry.pendingDiff = {
      promise: Promise.resolve(undefined),
      timeout,
    };
  }

  /**
   * Execute the actual diff stats fetch.
   */
  private async executeDiffStatsUpdate(
    cwd: string,
    repoKey: string
  ): Promise<void> {
    const entry = this.cache.get(repoKey);
    if (!entry) return;

    // Create in-flight promise
    const fetchPromise = this.fetchDiffStats(cwd);
    entry.pendingDiff = {
      promise: fetchPromise,
      timeout: entry.pendingDiff?.timeout ?? setTimeout(() => {}, 0),
    };

    try {
      const diffStats = await fetchPromise;

      // Only update if entry still exists
      const currentEntry = this.cache.get(repoKey);
      if (currentEntry) {
        currentEntry.metadata = {
          ...currentEntry.metadata,
          diffStats,
        };
        currentEntry.pendingDiff = undefined;
      }
    } catch {
      // Clear pending state on error
      const currentEntry = this.cache.get(repoKey);
      if (currentEntry) {
        currentEntry.pendingDiff = undefined;
      }
    }
  }
}

/** Singleton cache instance (initialized lazily) */
let globalCache: GitMetadataCache | undefined;

/** Get or create the global metadata cache */
export function getGlobalGitMetadataCache(options: {
  fetchGitInfo: FetchGitInfoFn;
  fetchDiffStats: FetchDiffStatsFn;
  diffDebounceMs?: number;
}): GitMetadataCache {
  if (!globalCache) {
    globalCache = new GitMetadataCache(options);
  }
  return globalCache;
}

/** Clear the global cache (useful for testing) */
export function clearGlobalGitMetadataCache(): void {
  globalCache?.clear();
  globalCache = undefined;
}
