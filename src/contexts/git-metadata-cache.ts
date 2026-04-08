/**
 * Centralized git metadata cache for aggregate view.
 *
 * The cache deduplicates git fetches per repository, but callers always receive
 * detached snapshots so aggregate rows never share mutable metadata objects.
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
  isWorktree: boolean;
  commonDir: string | null;
  diffStats: GitDiffStats | undefined;
  lastUpdated: number;
}

interface GetMetadataOptions {
  skipDiffStats?: boolean;
  forceRefresh?: boolean;
}

type FetchGitInfoFn = (cwd: string) => Promise<GitInfo | undefined>;
type FetchDiffStatsFn = (cwd: string) => Promise<GitDiffStats | undefined>;

function cloneDiffStats(stats: GitDiffStats | undefined): GitDiffStats | undefined {
  return stats ? { ...stats } : undefined;
}

function cloneMetadata(metadata: GitRepoMetadata): GitRepoMetadata {
  return {
    ...metadata,
    diffStats: cloneDiffStats(metadata.diffStats),
  };
}

export class GitMetadataCache {
  private cache = new Map<string, GitRepoMetadata>();
  private cwdToRepoKey = new Map<string, string>();
  private inFlight = new Map<string, Promise<GitRepoMetadata | undefined>>();
  private fetchGitInfo: FetchGitInfoFn;
  private fetchDiffStats: FetchDiffStatsFn;

  constructor(options: { fetchGitInfo: FetchGitInfoFn; fetchDiffStats: FetchDiffStatsFn }) {
    this.fetchGitInfo = options.fetchGitInfo;
    this.fetchDiffStats = options.fetchDiffStats;
  }

  async getMetadata(
    cwd: string,
    options: GetMetadataOptions = {}
  ): Promise<GitRepoMetadata | undefined> {
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

    const fallbackByCwd = new Map(
      uniqueCwds.map(
        (cwd) =>
          [
            cwd,
            options.forceRefresh ? undefined : this.getCachedMetadata(cwd, { skipDiffStats: true }),
          ] as const
      )
    );

    const gitInfoEntries: Array<readonly [string, GitInfo | undefined]> = [];
    for (const cwd of uniqueCwds) {
      gitInfoEntries.push([cwd, await this.fetchGitInfo(cwd)] as const);
    }

    const repoGroups = new Map<
      string,
      { representativeCwd: string; gitInfo: GitInfo; cwds: string[] }
    >();

    for (const [cwd, gitInfo] of gitInfoEntries) {
      if (!gitInfo) {
        const fallback = fallbackByCwd.get(cwd);
        if (fallback && (options.skipDiffStats || fallback.diffStats !== undefined)) {
          results.set(cwd, fallback);
          continue;
        }

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
      const existing = this.cache.get(repoKey);
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
        isWorktree: group.gitInfo.isWorktree,
        commonDir: group.gitInfo.commonDir,
        diffStats: options.skipDiffStats
          ? cloneDiffStats(existing?.diffStats)
          : cloneDiffStats(diffStatsByRepo.get(repoKey)),
        lastUpdated: now,
      };

      this.cache.set(repoKey, nextMetadata);

      for (const cwd of group.cwds) {
        this.cwdToRepoKey.set(cwd, repoKey);
        results.set(cwd, cloneMetadata(nextMetadata));
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
      const cached = this.cache.get(repoKey);
      return cached ? cloneMetadata(cached) : undefined;
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

  private getCachedMetadata(cwd: string, options: GetMetadataOptions): GitRepoMetadata | undefined {
    const repoKey = this.cwdToRepoKey.get(cwd);
    if (!repoKey) {
      return undefined;
    }

    const metadata = this.cache.get(repoKey);
    if (!metadata) {
      return undefined;
    }

    if (options.forceRefresh) {
      return undefined;
    }

    if (!options.skipDiffStats && metadata.diffStats === undefined) {
      return undefined;
    }

    return cloneMetadata(metadata);
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
