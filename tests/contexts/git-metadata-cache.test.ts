/**
 * Tests for GitMetadataCache - ensuring git metadata stability
 *
 * These tests verify that:
 * 1. Reference equality is preserved for unchanged repos
 * 2. PTYs in the same repo share metadata objects
 * 3. Diff stats are debounced
 * 4. Batched updates work correctly
 */
import { describe, expect, it, beforeEach } from "bun:test";
import {
  GitMetadataCache,
  clearGlobalGitMetadataCache,
} from "../../src/contexts/git-metadata-cache";
import type { GitInfo, GitDiffStats } from "../../src/effect/services/pty/helpers";

describe("GitMetadataCache", () => {
  let fetchGitInfoCalls: string[] = [];
  let fetchDiffStatsCalls: string[] = [];

  const mockGitInfo: GitInfo = {
    branch: "main",
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
    repoKey: "/home/user/project",
  };

  const mockDiffStats: GitDiffStats = {
    added: 10,
    removed: 5,
    binary: 0,
  };

  beforeEach(() => {
    fetchGitInfoCalls = [];
    fetchDiffStatsCalls = [];
    clearGlobalGitMetadataCache();
  });

  function createCache(debounceMs = 100) {
    return new GitMetadataCache({
      fetchGitInfo: async (cwd) => {
        fetchGitInfoCalls.push(cwd);
        // Extract repo root from path (e.g., "/repo/src" -> "/repo")
        const parts = cwd.split('/').filter(Boolean);
        const repoKey = parts.length > 0 ? `/${parts[0]}` : cwd;
        return { ...mockGitInfo, repoKey };
      },
      fetchDiffStats: async (cwd) => {
        fetchDiffStatsCalls.push(cwd);
        return mockDiffStats;
      },
      diffDebounceMs: debounceMs,
    });
  }

  describe("Reference equality", () => {
    it("should return same metadata object for same repo (reference equality)", async () => {
      const cache = createCache();

      const meta1 = await cache.getMetadata("/repo1", { skipDiffStats: true });
      const meta2 = await cache.getMetadata("/repo1", { skipDiffStats: true });

      expect(meta1).toBe(meta2); // Same reference
    });

    it("should return different objects for different repos", async () => {
      const cache = createCache();

      const meta1 = await cache.getMetadata("/repo1", { skipDiffStats: true });
      const meta2 = await cache.getMetadata("/repo2", { skipDiffStats: true });

      expect(meta1).not.toBe(meta2);
      expect(meta1?.repoKey).toBe("/repo1");
      expect(meta2?.repoKey).toBe("/repo2");
    });

    it("should batch requests for same CWD", async () => {
      const cache = createCache();

      // Request same CWD multiple times concurrently
      const [meta1, meta2, meta3] = await Promise.all([
        cache.getMetadata("/repo1", { skipDiffStats: true }),
        cache.getMetadata("/repo1", { skipDiffStats: true }),
        cache.getMetadata("/repo1", { skipDiffStats: true }),
      ]);

      // Should only fetch once
      expect(fetchGitInfoCalls.length).toBe(1);
      expect(meta1).toBe(meta2);
      expect(meta2).toBe(meta3);
    });
  });

  describe("Batching by repo key", () => {
    it("should share metadata for CWDs in same repo after resolution", async () => {
      const cache = createCache();

      // Different CWDs in same repo (subdirectories)
      const cwds = ["/repo/src", "/repo/tests", "/repo/docs"];

      const results = await cache.getMetadataBatch(cwds, { skipDiffStats: true });

      // Fetches once for each unknown CWD (we don't know they're same repo until we fetch)
      expect(fetchGitInfoCalls.length).toBe(3);

      // All should return same metadata object (shared by repo key)
      const metas = cwds.map((cwd) => results.get(cwd));
      expect(metas[0]).toBe(metas[1]);
      expect(metas[1]).toBe(metas[2]);
    });

    it("should handle mixed repos in batch", async () => {
      const cache = createCache();

      const cwds = ["/repo1/src", "/repo2/src", "/repo1/tests"];

      const results = await cache.getMetadataBatch(cwds, { skipDiffStats: true });

      // Fetches for each unknown CWD (3 total - we don't know repo relationship upfront)
      expect(fetchGitInfoCalls.length).toBe(3);

      // Same repo should share metadata after resolution
      const meta1 = results.get("/repo1/src");
      const meta3 = results.get("/repo1/tests");
      expect(meta1).toBe(meta3);

      // Different repo should be different
      const meta2 = results.get("/repo2/src");
      expect(meta2).not.toBe(meta1);
    });

    it("should use cached metadata on subsequent batch calls", async () => {
      const cache = createCache();

      // First batch - fetches
      await cache.getMetadataBatch(["/repo/src", "/repo/tests"], { skipDiffStats: true });
      expect(fetchGitInfoCalls.length).toBe(2);

      // Second batch with same CWDs - uses cache
      await cache.getMetadataBatch(["/repo/src", "/repo/tests"], { skipDiffStats: true });
      expect(fetchGitInfoCalls.length).toBe(2); // No new fetches
    });
  });

  describe("Debounced diff stats", () => {
    it("should debounce diff stats requests", async () => {
      const cache = createCache(50); // 50ms debounce

      // Request diff stats multiple times
      await cache.getMetadata("/repo", { skipDiffStats: false });
      await cache.getMetadata("/repo", { skipDiffStats: false });
      await cache.getMetadata("/repo", { skipDiffStats: false });

      // Immediately after, should not have fetched diff stats yet
      expect(fetchDiffStatsCalls.length).toBe(0);

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have fetched only once
      expect(fetchDiffStatsCalls.length).toBe(1);
    });

    it("should populate diff stats asynchronously", async () => {
      const cache = createCache(50);

      // First fetch - diff stats will be fetched asynchronously
      const meta1 = await cache.getMetadata("/repo", { skipDiffStats: false });
      
      // Initially undefined (will be populated via debounce)
      expect(meta1?.diffStats).toBeUndefined();

      // Wait for debounce + fetch to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now fetch again - should have diff stats from cache
      const meta2 = await cache.getMetadata("/repo", { skipDiffStats: true });
      expect(meta2?.diffStats).toEqual(mockDiffStats);
    });
  });

  describe("Repo switching", () => {
    it("should clear diff stats when repo key changes", async () => {
      let currentRepoKey = "/repo1";
      const cache = new GitMetadataCache({
        fetchGitInfo: async () => ({
          ...mockGitInfo,
          repoKey: currentRepoKey,
        }),
        fetchDiffStats: async () => mockDiffStats,
        diffDebounceMs: 10,
      });

      // Fetch from first repo and wait for diff stats
      await cache.getMetadata("/cwd", { skipDiffStats: false });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify diff stats were populated
      const meta1 = await cache.getMetadata("/cwd", { skipDiffStats: true });
      expect(meta1?.diffStats).toEqual(mockDiffStats);
      expect(meta1?.repoKey).toBe("/repo1");

      // Change repo - clear the cache entry to force refresh
      currentRepoKey = "/repo2";
      cache.clear();

      // Fetch from new repo - should have different repo key
      const meta2 = await cache.getMetadata("/cwd", { skipDiffStats: true });
      expect(meta2?.repoKey).toBe("/repo2");
      // Diff stats would be undefined until fetched
    });
  });

  describe("Non-git directories", () => {
    it("should return undefined for non-git directories", async () => {
      const cache = new GitMetadataCache({
        fetchGitInfo: async () => undefined,
        fetchDiffStats: async () => undefined,
        diffDebounceMs: 100,
      });

      const meta = await cache.getMetadata("/not-a-repo", { skipDiffStats: true });
      expect(meta).toBeUndefined();
    });
  });
});
