import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  GitMetadataCache,
  clearGlobalGitMetadataCache,
  getGlobalGitMetadataCache,
} from '../../../src/contexts/git-metadata-cache';

describe('Git metadata stability - current cache behavior', () => {
  beforeEach(() => {
    clearGlobalGitMetadataCache();
  });

  it('shares one metadata object across PTYs in the same repo', async () => {
    const cache = new GitMetadataCache({
      fetchGitInfo: async (cwd) => ({
        repoKey: 'repo-1',
        branch: cwd.includes('a') ? 'main' : 'main',
        dirty: true,
        staged: 1,
        unstaged: 2,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'none',
        detached: false,
      }),
      fetchDiffStats: async () => ({ added: 5, removed: 3, binary: 0 }),
      diffDebounceMs: 10,
    });

    const metadata = await cache.getMetadataBatch(['/project/a', '/project/b']);

    expect(metadata.get('/project/a')).toBe(metadata.get('/project/b'));
  });

  it('preserves diff stats while serving fresh cached metadata', async () => {
    const fetchGitInfo = vi.fn(async () => ({
      repoKey: 'repo-1',
      branch: 'main',
      dirty: true,
      staged: 1,
      unstaged: 2,
      untracked: 0,
      conflicted: 0,
      ahead: undefined,
      behind: undefined,
      stashCount: undefined,
      state: 'none',
      detached: false,
    }));

    const cache = new GitMetadataCache({
      fetchGitInfo,
      fetchDiffStats: async () => ({ added: 9, removed: 4, binary: 1 }),
      diffDebounceMs: 5,
    });

    const first = await cache.getMetadata('/project/a', { skipDiffStats: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const withDiff = await cache.getMetadata('/project/a', { skipDiffStats: true });

    expect(withDiff?.diffStats).toEqual({ added: 9, removed: 4, binary: 1 });
    expect(first?.repoKey).toBe('repo-1');
    expect(fetchGitInfo).toHaveBeenCalledTimes(1);
  });

  it('does not reuse metadata across different repos', async () => {
    const cache = new GitMetadataCache({
      fetchGitInfo: async (cwd) => ({
        repoKey: cwd.includes('repo-a') ? 'repo-a' : 'repo-b',
        branch: cwd.includes('repo-a') ? 'feature-a' : 'feature-b',
        dirty: true,
        staged: 0,
        unstaged: 1,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'none',
        detached: false,
      }),
      fetchDiffStats: async () => ({ added: 1, removed: 0, binary: 0 }),
    });

    const repoA = await cache.getMetadata('/repo-a/worktree');
    const repoB = await cache.getMetadata('/repo-b/worktree');

    expect(repoA?.repoKey).toBe('repo-a');
    expect(repoB?.repoKey).toBe('repo-b');
    expect(repoA).not.toBe(repoB);
  });

  it('debounces diff-stat fetches so the last request wins without flicker', async () => {
    vi.useFakeTimers();

    let diffValue = { added: 1, removed: 0, binary: 0 };
    const cache = getGlobalGitMetadataCache({
      fetchGitInfo: async () => ({
        repoKey: 'repo-1',
        branch: 'main',
        dirty: true,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'none',
        detached: false,
      }),
      fetchDiffStats: async () => diffValue,
      diffDebounceMs: 50,
    });

    await cache.getMetadata('/repo', { skipDiffStats: false });
    diffValue = { added: 7, removed: 2, binary: 0 };
    await cache.getMetadata('/repo', { skipDiffStats: false });
    vi.advanceTimersByTime(60);
    await Promise.resolve();
    await Promise.resolve();

    const metadata = await cache.getMetadata('/repo', { skipDiffStats: true });
    expect(metadata?.diffStats).toEqual({ added: 7, removed: 2, binary: 0 });

    vi.useRealTimers();
  });
});
