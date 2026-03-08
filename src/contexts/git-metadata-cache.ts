/**
 * Centralized git metadata cache for aggregate view.
 *
 * The cache keeps repo-level object sharing and explicit refresh control:
 * - All PTYs in the same repo share one metadata object
 * - Callers choose when to force a refresh
 * - Full metadata (including diff stats) is fetched synchronously when requested
 * - No background debounce path for correctness-critical updates
 */

import type { GitInfo, GitDiffStats } from '../effect/services/pty/helpers';

export interface GitRepoMetadata {
  repoKey: string;
  branch: string | undefined;
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  ahead: number | undefined;
  behind: number | undefined;
  stashCount: number | undefined;
  state: GitInfo['state'] | undefined;
  detached: boolean;
  diffStats: GitDiffStats | undefined;
  lastUpdated: number;
}

interface CacheEntry {
  metadata: GitRepoMetadata;
}

interface GetMetadataOptions {
  skipDiffStats?: boolean;
  forceRefresh?: boolean;
}

type FetchGitInfoFn = (cwd: string) => Promise<GitInfo | undefined>;
type FetchDiffStatsFn = (cwd: string) => Promise<GitDiffStats | undefined>;

function areDiffStatsEqual(
  a: GitDiffStats | undefined,
  b: GitDiffStats | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.added === b.added && a.removed === b.removed && a.binary === b.binary;
}

function areMetadataEqual(a: GitRepoMetadata, b: GitRepoMetadata): boolean {
  return (
    a.repoKey === b.repoKey &&
    a.branch === b.branch &&
    a.dirty === b.dirty &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.untracked === b.untracked &&
    a.conflicted === b.conflicted &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.stashCount === b.stashCount &&
    a.state === b.state &&
    a.detached === b.detached &&
    areDiffStatsEqual(a.diffStats, b.diffStats)
  );
}

export class GitMetadataCache {
  private cache = new Map<string, CacheEntry>();
  private cwdToRepoKey = new Map<string, string>();
  private inFlight = new Map<string, Promise<GitRepoMetadata | undefined>>();
  private fetchGitInfo: FetchGitInfoFn;
  private fetchDiffStats: FetchDiffStatsFn;

  constructor(options: {
    fetchGitInfo: FetchGitInfoFn;
    fetchDiffStats: FetchDiffStatsFn;
  }) {
    this.fetchGitInfo = options.fetchGitInfo;
    this.fetchDiffStats = options.fetchDiffStats;
  }

  async getMetadata(
    cwd: string,
    options: GetMetadataOptions = {}
  ): Promise<GitRepoMetadata | undefined> {
    const cached = this.getCachedMetadata(cwd, options);
    if (cached) {
      return cached;
    }

    const requestKey = `${cwd}|skip:${options.skipDiffStats ? '1' : '0'}|force:${options.forceRefresh ? '1' : '0'}`;
    const inFlight = this.inFlight.get(requestKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.getMetadataBatch([cwd], options).then((results) => results.get(cwd));
    this.inFlight.set(requestKey, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  async getMetadataBatch(
    cwds: string[],
    options: GetMetadataOptions = {}
  ): Promise<Map<string, GitRepoMetadata>> {
    const results = new Map<string, GitRepoMetadata>();
    const uniqueCwds = [...new Set(cwds)];
    if (uniqueCwds.length === 0) {
      return results;
    }

    if (!options.forceRefresh) {
      let allSatisfiedFromCache = true;
      for (const cwd of uniqueCwds) {
        const cached = this.getCachedMetadata(cwd, options);
        if (!cached) {
          allSatisfiedFromCache = false;
          break;
        }
        results.set(cwd, cached);
      }

      if (allSatisfiedFromCache) {
        return results;
      }

      results.clear();
    }

    const gitInfoEntries: Array<readonly [string, GitInfo | undefined]> = [];
    for (const cwd of uniqueCwds) {
      gitInfoEntries.push([cwd, await this.fetchGitInfo(cwd)] as const);
    }

    const repoGroups = new Map<string, { representativeCwd: string; gitInfo: GitInfo; cwds: string[] }>();

    for (const [cwd, gitInfo] of gitInfoEntries) {
      if (!gitInfo) {
        this.cwdToRepoKey.delete(cwd);
        continue;
      }

      const existingGroup = repoGroups.get(gitInfo.repoKey);
      if (existingGroup) {
        existingGroup.cwds.push(cwd);
        continue;
      }

      repoGroups.set(gitInfo.repoKey, {
        representativeCwd: cwd,
        gitInfo,
        cwds: [cwd],
      });
    }

    const diffStatsByRepo = new Map<string, GitDiffStats | undefined>();
    if (!options.skipDiffStats) {
      for (const group of repoGroups.values()) {
        const diffStats = await this.fetchDiffStats(group.representativeCwd);
        diffStatsByRepo.set(group.gitInfo.repoKey, diffStats);
      }
    }

    for (const [repoKey, group] of repoGroups) {
      const existing = this.cache.get(repoKey)?.metadata;
      const now = Date.now();
      const nextMetadata: GitRepoMetadata = {
        repoKey,
        branch: group.gitInfo.branch,
        dirty: group.gitInfo.dirty,
        staged: group.gitInfo.staged,
        unstaged: group.gitInfo.unstaged,
        untracked: group.gitInfo.untracked,
        conflicted: group.gitInfo.conflicted,
        ahead: group.gitInfo.ahead,
        behind: group.gitInfo.behind,
        stashCount: group.gitInfo.stashCount,
        state: group.gitInfo.state,
        detached: group.gitInfo.detached,
        diffStats: options.skipDiffStats
          ? existing?.diffStats
          : diffStatsByRepo.get(repoKey),
        lastUpdated: now,
      };

      const stableMetadata = existing && areMetadataEqual(existing, nextMetadata)
        ? existing
        : nextMetadata;

      this.cache.set(repoKey, { metadata: stableMetadata });

      for (const cwd of group.cwds) {
        this.cwdToRepoKey.set(cwd, repoKey);
        results.set(cwd, stableMetadata);
      }
    }

    return results;
  }

  async refreshRepo(repoKey: string): Promise<GitRepoMetadata | undefined> {
    let cwd: string | undefined;
    for (const [candidateCwd, candidateRepoKey] of this.cwdToRepoKey) {
      if (candidateRepoKey === repoKey) {
        cwd = candidateCwd;
        break;
      }
    }

    if (!cwd) {
      return this.cache.get(repoKey)?.metadata;
    }

    return this.getMetadata(cwd, { forceRefresh: true });
  }

  getRepoKey(cwd: string): string | undefined {
    return this.cwdToRepoKey.get(cwd);
  }

  hasRepo(cwd: string): boolean {
    const repoKey = this.cwdToRepoKey.get(cwd);
    return repoKey ? this.cache.has(repoKey) : false;
  }

  clear(): void {
    this.cache.clear();
    this.cwdToRepoKey.clear();
    this.inFlight.clear();
  }

  private getCachedMetadata(
    cwd: string,
    options: GetMetadataOptions
  ): GitRepoMetadata | undefined {
    const repoKey = this.cwdToRepoKey.get(cwd);
    if (!repoKey) {
      return undefined;
    }

    const entry = this.cache.get(repoKey);
    if (!entry) {
      return undefined;
    }

    if (options.forceRefresh) {
      return undefined;
    }

    if (!options.skipDiffStats && entry.metadata.diffStats === undefined) {
      return undefined;
    }

    return entry.metadata;
  }
}

let globalCache: GitMetadataCache | undefined;

export function getGlobalGitMetadataCache(options: {
  fetchGitInfo: FetchGitInfoFn;
  fetchDiffStats: FetchDiffStatsFn;
}): GitMetadataCache {
  if (!globalCache) {
    globalCache = new GitMetadataCache(options);
  }
  return globalCache;
}

export function clearGlobalGitMetadataCache(): void {
  globalCache?.clear();
  globalCache = undefined;
}
