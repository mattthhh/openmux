/**
 * Test for git metadata flickering bug in aggregate view subset refresh.
 *
 * This test captures the issue where using `forceRefresh: true` in the polling
 * subset refresh causes git metadata (like +/- diff stats) to temporarily clear
 * when git commands encounter transient failures (race conditions, file locks).
 *
 * The bug occurs because:
 * 1. Subset refresh uses forceRefresh: true to re-fetch git metadata
 * 2. If fetchGitInfo temporarily returns undefined (failure), the cache deletes the CWD mapping
 * 3. This causes extractGitMetadata(undefined) to return empty defaults
 * 4. The PTY's git stats appear to flicker (clear then come back on next poll)
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { GitMetadataCache, clearGlobalGitMetadataCache } from '../../git-metadata-cache';
import { extractGitMetadata } from '../git/metadata';
import type { GitInfo, GitDiffStats } from '../../../effect/services/pty/helpers';

describe('GitMetadataCache - flickering bug', () => {
  let fetchGitInfoCalls: number;
  let shouldFailNextFetch: boolean;
  let cachedGitInfo: GitInfo | undefined;

  const mockGitInfo: GitInfo = {
    branch: 'main',
    dirty: true,
    staged: 2,
    unstaged: 3,
    untracked: 0,
    conflicted: 0,
    ahead: 1,
    behind: 0,
    stashCount: 0,
    state: undefined,
    detached: false,
    repoKey: '/home/user/project',
  };

  const mockDiffStats: GitDiffStats = {
    added: 42,
    removed: 15,
    binary: 0,
  };

  beforeEach(() => {
    fetchGitInfoCalls = 0;
    shouldFailNextFetch = false;
    cachedGitInfo = { ...mockGitInfo };
    clearGlobalGitMetadataCache();
  });

  function createCache() {
    return new GitMetadataCache({
      fetchGitInfo: async (cwd) => {
        fetchGitInfoCalls++;
        // Simulate transient failure on certain calls
        if (shouldFailNextFetch) {
          return undefined;
        }
        return cachedGitInfo;
      },
      fetchDiffStats: async () => mockDiffStats,
    });
  }

  it('should preserve cached metadata when not using forceRefresh', async () => {
    const cache = createCache();

    // First call - populate cache with full metadata
    const first = await cache.getMetadata('/project', { skipDiffStats: false });
    expect(first?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });
    expect(first?.branch).toBe('main');
    expect(fetchGitInfoCalls).toBe(1);

    // Simulate transient failure
    shouldFailNextFetch = true;

    // Second call WITHOUT forceRefresh - should use cached value
    const second = await cache.getMetadata('/project', { skipDiffStats: false });

    // Should NOT have called fetchGitInfo again (or if it did, it should use cached)
    // With forceRefresh: false, we should get the cached metadata
    expect(second?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });
    expect(second?.branch).toBe('main');
  });

  it('should demonstrate the flickering bug with forceRefresh during transient failure', async () => {
    const cache = createCache();

    // First call - populate cache with full metadata
    const first = await cache.getMetadata('/project', { skipDiffStats: false });
    expect(first?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });

    // Simulate transient failure (e.g., git command temporarily fails due to lock)
    shouldFailNextFetch = true;

    // Second call WITH forceRefresh: true - simulates subset refresh behavior
    const second = await cache.getMetadata('/project', {
      skipDiffStats: false,
      forceRefresh: true,
    });

    // BUG: With forceRefresh: true and a transient failure, metadata is cleared!
    // The cache deletes the CWD mapping when fetchGitInfo returns undefined
    expect(second).toBeUndefined();

    // When extractGitMetadata receives undefined, it returns empty defaults
    const extracted = extractGitMetadata(second);
    expect(extracted.gitDiffStats).toBeUndefined();
    expect(extracted.gitBranch).toBeUndefined();
    expect(extracted.gitDirty).toBe(false);
    expect(extracted.gitStaged).toBe(0);
    expect(extracted.gitUnstaged).toBe(0);

    // This is the "flicker" - the +/- stats temporarily disappear!
    // On the next successful poll, they'll come back.
  });

  it('should show how subset refresh pattern causes flickering', async () => {
    // ==================================================================
    // BUGGY BEHAVIOR: Using forceRefresh: true in subset refresh
    // ==================================================================
    const buggyCache = createCache();

    // Populate cache initially (like initial load does)
    const cwds = ['/project/src', '/project/docs'];
    const initialResults = await buggyCache.getMetadataBatch(cwds, { forceRefresh: true });

    // Verify initial state has diff stats
    const srcMeta = initialResults.get('/project/src');
    expect(srcMeta?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });

    // Simulate what happens during subset refresh with transient failure
    shouldFailNextFetch = true;

    // This simulates the OLD buggy behavior: subset refresh with forceRefresh: true
    const subsetResultsBuggy = await buggyCache.getMetadataBatch(cwds, { forceRefresh: true });

    // BUG: Metadata is cleared due to transient failure because:
    // 1. forceRefresh: true skips cache lookup
    // 2. fetchGitInfo returns undefined (simulated failure)
    // 3. Cache deletes CWD mapping when gitInfo is undefined
    // 4. extractGitMetadata(undefined) returns empty defaults
    const srcMetaBuggy = subsetResultsBuggy.get('/project/src');
    expect(srcMetaBuggy).toBeUndefined();

    // ==================================================================
    // FIXED BEHAVIOR: Using forceRefresh: false in subset refresh
    // ==================================================================
    clearGlobalGitMetadataCache();
    shouldFailNextFetch = false;

    const fixedCache = createCache();

    // Populate cache (initial load)
    await fixedCache.getMetadataBatch(cwds, { forceRefresh: true });

    // Simulate transient failure during subset refresh
    shouldFailNextFetch = true;

    // FIXED: Using forceRefresh: false - returns cached metadata
    const subsetResultsFixed = await fixedCache.getMetadataBatch(cwds, {
      forceRefresh: false, // THE FIX!
    });

    // Metadata is preserved despite the failure because:
    // 1. forceRefresh: false checks cache first
    // 2. Cache has data from initial load, returns it immediately
    // 3. No git command is executed, so transient failure is avoided
    const srcMetaFixed = subsetResultsFixed.get('/project/src');
    expect(srcMetaFixed?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });
    expect(srcMetaFixed?.branch).toBe('main');
  });

  it('should demonstrate real-world flicker scenario in aggregate view', async () => {
    /**
     * This simulates the real-world scenario:
     * 1. User is in aggregate view, sees git stats (+42/-15) on a PTY
     * 2. User interacts with PTY, causing output
     * 3. Subset refresh (2s polling) triggers with forceRefresh: true
     * 4. Git command temporarily fails (race condition)
     * 5. Git stats temporarily clear (flicker visible to user)
     * 6. Next poll succeeds, stats reappear
     */

    const cache = createCache();

    // Step 1: Initial load - git stats are populated
    const initial = await cache.getMetadata('/workspace', { skipDiffStats: false });
    expect(initial?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });

    // Step 2: User interacts, time passes...
    // Step 3: Subset refresh triggers

    // Step 4: Transient git failure occurs (simulating race condition)
    shouldFailNextFetch = true;

    // OLD behavior (forceRefresh: true) - causes flicker
    const buggyRefresh = await cache.getMetadata('/workspace', {
      skipDiffStats: false,
      forceRefresh: true,
    });

    // Step 5: Git stats appear to "clear" - this is the visible flicker!
    expect(buggyRefresh).toBeUndefined();
    const buggyExtracted = extractGitMetadata(buggyRefresh);
    expect(buggyExtracted.gitDiffStats).toBeUndefined(); // +/- stats disappear!

    // User sees: "+42/-15" → "" → "+42/-15" (flicker!)

    // Step 6: Next poll succeeds (no failure)
    shouldFailNextFetch = false;

    // But now we need to re-populate because cache was cleared
    const recovery = await cache.getMetadata('/workspace', { skipDiffStats: false });
    expect(recovery?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });

    // FIXED behavior: using forceRefresh: false prevents the flicker
    clearGlobalGitMetadataCache();
    const cacheFixed = createCache();

    // Initial load
    await cacheFixed.getMetadata('/workspace', { skipDiffStats: false });

    // Transient failure during subset refresh
    shouldFailNextFetch = true;

    // With forceRefresh: false, cached value is returned
    const fixedRefresh = await cacheFixed.getMetadata('/workspace', {
      skipDiffStats: false,
      forceRefresh: false, // FIXED!
    });

    // Stats are preserved - no flicker!
    expect(fixedRefresh?.diffStats).toEqual({ added: 42, removed: 15, binary: 0 });
  });
});
