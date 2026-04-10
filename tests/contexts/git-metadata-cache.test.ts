import { beforeEach, describe, expect, it } from 'bun:test';
import {
  GitMetadataCache,
  clearGlobalGitMetadataCache,
} from '../../src/contexts/git-metadata-cache';
import type { GitInfo, GitDiffStats } from '../../src/effect/services/pty/helpers';

describe('GitMetadataCache', () => {
  let fetchGitInfoCalls: string[] = [];
  let fetchDiffStatsCalls: string[] = [];

  const mockGitInfo: GitInfo = {
    branch: 'main',
    dirty: true,
    staged: 1,
    unstaged: 2,
    untracked: 0,
    conflicted: 0,
    ahead: 0,
    behind: 0,
    stashCount: 0,
    state: undefined,
    detached: false,
    repoKey: '/home/user/project',
  };

  const mockDiffStats: GitDiffStats = {
    added: 10,
    removed: 5,
    binary: 0,
  };

  beforeEach(() => {
    fetchGitInfoCalls.length = 0;
    fetchDiffStatsCalls.length = 0;
    clearGlobalGitMetadataCache();
  });

  function createCache() {
    return new GitMetadataCache({
      fetchGitInfo: async (cwd) => {
        fetchGitInfoCalls.push(cwd);
        const parts = cwd.split('/').filter(Boolean);
        const repoKey = parts.length > 0 ? `/${parts[0]}` : cwd;
        return { ...mockGitInfo, repoKey };
      },
      fetchDiffStats: async (cwd) => {
        fetchDiffStatsCalls.push(cwd);
        return mockDiffStats;
      },
    });
  }

  describe('Detached snapshots', () => {
    it('should return equivalent detached metadata snapshots for repeated reads', async () => {
      const cache = createCache();

      const meta1 = await cache.getMetadata('/repo1', { skipDiffStats: true });
      const meta2 = await cache.getMetadata('/repo1', { skipDiffStats: true });

      // Verify metadata values are equal (equivalent snapshots)
      expect(meta1).toEqual(meta2);
      // Verify they are different objects (detached snapshots)
      expect(meta1).not.toBe(meta2);
      // Verify the repoKey is correctly set from the fetch
      expect(meta1?.repoKey).toBe('/repo1');
    });

    it('should return different objects for different repos', async () => {
      const cache = createCache();

      const meta1 = await cache.getMetadata('/repo1', { skipDiffStats: true });
      const meta2 = await cache.getMetadata('/repo2', { skipDiffStats: true });

      expect(meta1).not.toBe(meta2);
      expect(meta1?.repoKey).toBe('/repo1');
      expect(meta2?.repoKey).toBe('/repo2');
    });

    it('should batch concurrent requests for the same cwd', async () => {
      const cache = createCache();

      const [meta1, meta2, meta3] = await Promise.all([
        cache.getMetadata('/repo1', { skipDiffStats: true }),
        cache.getMetadata('/repo1', { skipDiffStats: true }),
        cache.getMetadata('/repo1', { skipDiffStats: true }),
      ]);

      expect(fetchGitInfoCalls.length).toBe(1);
      expect(meta1).toBe(meta2);
      expect(meta2).toBe(meta3);
    });
  });

  describe('Batching by repo key', () => {
    it('should share metadata for CWDs in same repo after resolution', async () => {
      const cache = createCache();
      const cwds = ['/repo/src', '/repo/tests', '/repo/docs'];

      const results = await cache.getMetadataBatch(cwds, { skipDiffStats: true });

      expect(fetchGitInfoCalls.length).toBe(3);

      const metas = cwds.map((cwd) => results.get(cwd));
      expect(metas[0]).toEqual(metas[1]);
      expect(metas[1]).toEqual(metas[2]);
      expect(metas[0]).not.toBe(metas[1]);
      expect(metas[1]).not.toBe(metas[2]);
    });

    it('should resolve repos sequentially to avoid underlying git-helper race conditions', async () => {
      let activeFetches = 0;
      const cache = new GitMetadataCache({
        fetchGitInfo: async (cwd) => {
          activeFetches += 1;
          if (activeFetches > 1) {
            throw new Error('fetchGitInfo must not run concurrently');
          }
          await Promise.resolve();
          activeFetches -= 1;
          return {
            ...mockGitInfo,
            repoKey: cwd,
          };
        },
        fetchDiffStats: async () => undefined,
      });

      const results = await cache.getMetadataBatch(['/repo-a', '/repo-b'], { skipDiffStats: true });

      expect(results.get('/repo-a')?.repoKey).toBe('/repo-a');
      expect(results.get('/repo-b')?.repoKey).toBe('/repo-b');
    });

    it('should handle mixed repos in batch', async () => {
      const cache = createCache();
      const cwds = ['/repo1/src', '/repo2/src', '/repo1/tests'];

      const results = await cache.getMetadataBatch(cwds, { skipDiffStats: true });

      expect(fetchGitInfoCalls.length).toBe(3);
      expect(results.get('/repo1/src')).toEqual(results.get('/repo1/tests'));
      expect(results.get('/repo1/src')).not.toBe(results.get('/repo1/tests'));
      expect(results.get('/repo2/src')?.repoKey).toBe('/repo2');
      expect(results.get('/repo1/src')?.repoKey).toBe('/repo1');
    });

    it('should revalidate metadata on subsequent batch calls', async () => {
      const cache = createCache();

      await cache.getMetadataBatch(['/repo/src', '/repo/tests'], { skipDiffStats: true });
      expect(fetchGitInfoCalls.length).toBe(2);

      await cache.getMetadataBatch(['/repo/src', '/repo/tests'], { skipDiffStats: true });
      expect(fetchGitInfoCalls.length).toBe(4);
    });
  });

  describe('Synchronous full metadata refresh', () => {
    it('should fetch diff stats immediately when full metadata is requested', async () => {
      const cache = createCache();

      const metadata = await cache.getMetadata('/repo', { skipDiffStats: false });

      expect(metadata?.diffStats).toEqual(mockDiffStats);
      expect(fetchDiffStatsCalls).toEqual(['/repo']);
    });

    it('should preserve cached diff stats on later lightweight reads', async () => {
      const cache = createCache();

      const first = await cache.getMetadata('/repo', { skipDiffStats: false });
      const second = await cache.getMetadata('/repo', { skipDiffStats: true });

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      expect(second?.diffStats).toEqual(mockDiffStats);
      expect(fetchGitInfoCalls.length).toBe(2);
      expect(fetchDiffStatsCalls.length).toBe(1);
    });

    it('should refresh metadata immediately when forceRefresh is set', async () => {
      let branch = 'main';
      let diffStats = { added: 1, removed: 0, binary: 0 };

      const cache = new GitMetadataCache({
        fetchGitInfo: async () => ({
          ...mockGitInfo,
          branch,
          repoKey: '/repo',
        }),
        fetchDiffStats: async () => diffStats,
      });

      const first = await cache.getMetadata('/repo', { skipDiffStats: false });
      branch = 'feature';
      diffStats = { added: 7, removed: 2, binary: 1 };

      const refreshed = await cache.getMetadata('/repo', {
        skipDiffStats: false,
        forceRefresh: true,
      });

      expect(refreshed?.branch).toBe('feature');
      expect(refreshed?.diffStats).toEqual({ added: 7, removed: 2, binary: 1 });
      expect(refreshed).not.toBe(first);
    });
  });

  describe('Non-git directories', () => {
    it('should return undefined for non-git directories', async () => {
      const cache = new GitMetadataCache({
        fetchGitInfo: async () => undefined,
        fetchDiffStats: async () => undefined,
      });

      const meta = await cache.getMetadata('/not-a-repo', { skipDiffStats: true });
      expect(meta).toBeUndefined();
    });
  });
});
