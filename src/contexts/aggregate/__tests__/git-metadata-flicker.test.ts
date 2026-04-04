/**
 * Regression tests for aggregate git metadata cache refresh behavior.
 *
 * The aggregate cache must satisfy two invariants:
 * - keep previously known metadata when a refresh fails transiently
 * - refresh stale snapshots when the repo actually changes
 */

import { beforeEach, describe, expect, it } from 'bun:test';

import { GitMetadataCache, clearGlobalGitMetadataCache } from '../../git-metadata-cache';
import type { GitDiffStats, GitInfo } from '../../../effect/services/pty/helpers';

describe('GitMetadataCache refresh behavior', () => {
  let fetchGitInfoCalls: number;
  let shouldFailNextFetch: boolean;
  let currentGitInfo: GitInfo | undefined;
  let currentDiffStats: GitDiffStats | undefined;

  const dirtyGitInfo: GitInfo = {
    branch: 'main',
    dirty: true,
    staged: 2,
    unstaged: 3,
    untracked: 0,
    conflicted: 0,
    ahead: 7,
    behind: 0,
    stashCount: 0,
    state: undefined,
    detached: false,
    repoKey: '/home/user/project',
  };

  const cleanGitInfo: GitInfo = {
    ...dirtyGitInfo,
    dirty: false,
    staged: 0,
    unstaged: 0,
    ahead: 8,
  };

  const dirtyDiffStats: GitDiffStats = {
    added: 541,
    removed: 213,
    binary: 0,
  };

  beforeEach(() => {
    fetchGitInfoCalls = 0;
    shouldFailNextFetch = false;
    currentGitInfo = { ...dirtyGitInfo };
    currentDiffStats = { ...dirtyDiffStats };
    clearGlobalGitMetadataCache();
  });

  function createCache() {
    return new GitMetadataCache({
      fetchGitInfo: async () => {
        fetchGitInfoCalls++;
        if (shouldFailNextFetch) {
          return undefined;
        }
        return currentGitInfo;
      },
      fetchDiffStats: async () => currentDiffStats,
    });
  }

  it('preserves cached metadata when a non-forced refresh fails transiently', async () => {
    const cache = createCache();

    const first = await cache.getMetadata('/project', { skipDiffStats: false });
    expect(first?.diffStats).toEqual({ added: 541, removed: 213, binary: 0 });
    expect(first?.ahead).toBe(7);
    expect(fetchGitInfoCalls).toBe(1);

    shouldFailNextFetch = true;

    const second = await cache.getMetadata('/project', { skipDiffStats: false });

    expect(fetchGitInfoCalls).toBe(2);
    expect(second?.diffStats).toEqual({ added: 541, removed: 213, binary: 0 });
    expect(second?.ahead).toBe(7);
    expect(second?.dirty).toBe(true);
  });

  it('preserves cached metadata when a forced refresh fails transiently', async () => {
    const cache = createCache();

    await cache.getMetadata('/project', { skipDiffStats: false });
    shouldFailNextFetch = true;

    const refreshed = await cache.getMetadata('/project', {
      skipDiffStats: false,
      forceRefresh: true,
    });

    expect(refreshed?.diffStats).toEqual({ added: 541, removed: 213, binary: 0 });
    expect(refreshed?.ahead).toBe(7);
    expect(refreshed?.dirty).toBe(true);
  });

  it('refreshes cached metadata when the repo changes from dirty to clean', async () => {
    const cache = createCache();

    const first = await cache.getMetadata('/project', { skipDiffStats: false });
    expect(first?.diffStats).toEqual({ added: 541, removed: 213, binary: 0 });
    expect(first?.ahead).toBe(7);
    expect(first?.dirty).toBe(true);

    currentGitInfo = { ...cleanGitInfo };
    currentDiffStats = undefined;

    const second = await cache.getMetadata('/project', { skipDiffStats: false });

    expect(second?.diffStats).toBeUndefined();
    expect(second?.ahead).toBe(8);
    expect(second?.dirty).toBe(false);
    expect(second?.staged).toBe(0);
    expect(second?.unstaged).toBe(0);
  });

  it('refreshes all same-repo cwd aliases to the newest snapshot', async () => {
    const cache = createCache();
    const cwds = ['/project', '/project/src'];

    const first = await cache.getMetadataBatch(cwds, { skipDiffStats: false });
    expect(first.get('/project')?.ahead).toBe(7);
    expect(first.get('/project/src')?.ahead).toBe(7);
    expect(first.get('/project')?.diffStats).toEqual({ added: 541, removed: 213, binary: 0 });

    currentGitInfo = { ...cleanGitInfo };
    currentDiffStats = undefined;

    const second = await cache.getMetadataBatch(cwds, { skipDiffStats: false });

    expect(second.get('/project')?.ahead).toBe(8);
    expect(second.get('/project/src')?.ahead).toBe(8);
    expect(second.get('/project')?.diffStats).toBeUndefined();
    expect(second.get('/project/src')?.diffStats).toBeUndefined();
  });
});
