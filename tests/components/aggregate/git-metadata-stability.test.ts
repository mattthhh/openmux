import { describe, expect, it, vi } from 'bun:test';

const loadGitMetadataCacheModule = (() => {
  let nonce = 0;
  return () => import(`../../../src/contexts/git-metadata-cache.ts?git-cache=${nonce++}`);
})();

describe('Git metadata stability - synchronous aggregate behavior', () => {
  it('shares one metadata object across PTYs in the same repo', async () => {
    const { GitMetadataCache } = await loadGitMetadataCacheModule();
    const cache = new GitMetadataCache({
      fetchGitInfo: async () => ({
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
      }),
      fetchDiffStats: async () => ({ added: 5, removed: 3, binary: 0 }),
    });

    const metadata = await cache.getMetadataBatch(['/project/a', '/project/b'], {
      skipDiffStats: false,
    });

    expect(metadata.get('/project/a')).toBe(metadata.get('/project/b'));
    expect(metadata.get('/project/a')?.diffStats).toEqual({ added: 5, removed: 3, binary: 0 });
  });

  it('returns full diff stats immediately on a full fetch', async () => {
    const { GitMetadataCache } = await loadGitMetadataCacheModule();
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
    const fetchDiffStats = vi.fn(async () => ({ added: 9, removed: 4, binary: 1 }));

    const cache = new GitMetadataCache({
      fetchGitInfo,
      fetchDiffStats,
    });

    const metadata = await cache.getMetadata('/project/a', { skipDiffStats: false });

    expect(metadata?.diffStats).toEqual({ added: 9, removed: 4, binary: 1 });
    expect(fetchGitInfo).toHaveBeenCalledTimes(1);
    expect(fetchDiffStats).toHaveBeenCalledTimes(1);
  });

  it('does not reuse metadata across different repos', async () => {
    const { GitMetadataCache } = await loadGitMetadataCacheModule();
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

    const repoA = await cache.getMetadata('/repo-a/worktree', { skipDiffStats: false });
    const repoB = await cache.getMetadata('/repo-b/worktree', { skipDiffStats: false });

    expect(repoA?.repoKey).toBe('repo-a');
    expect(repoB?.repoKey).toBe('repo-b');
    expect(repoA).not.toBe(repoB);
  });

  it('force refreshes repo metadata immediately when the repo changes', async () => {
    const { getGlobalGitMetadataCache } = await loadGitMetadataCacheModule();
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
    });

    const first = await cache.getMetadata('/repo', { skipDiffStats: false });
    diffValue = { added: 7, removed: 2, binary: 0 };

    const refreshed = await cache.getMetadata('/repo', {
      skipDiffStats: false,
      forceRefresh: true,
    });

    expect(first?.diffStats).toEqual({ added: 1, removed: 0, binary: 0 });
    expect(refreshed?.diffStats).toEqual({ added: 7, removed: 2, binary: 0 });
    expect(refreshed).not.toBe(first);
  });
});
