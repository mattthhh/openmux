/**
 * Integration tests for AggregateViewContext - PTY name consistency issues
 *
 * These tests verify that:
 * 1. Title changes do NOT overwrite foregroundProcess (semantic bug)
 * 2. Index maps stay synchronized with array updates (race condition)
 */
import { describe, expect, it, beforeEach } from 'bun:test';
import { createStore, produce } from 'solid-js/store';
import type { PtyInfo, AggregateViewState } from '../../src/contexts/aggregate-view-types';
import { initialState } from '../../src/contexts/aggregate-view-types';
import { buildPtyIndex, recomputeMatches } from '../../src/contexts/aggregate-view-helpers';
import { createMetadataChangeHandler } from '../../src/contexts/aggregate-view-subscriptions';

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${Math.random().toString(36).substr(2, 9)}`,
    cwd: '/home/user/project',
    gitBranch: 'main',
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
    gitIsWorktree: false,
    gitCommonDir: null,
    foregroundProcess: 'bash',
    shell: '/bin/bash',
    title: undefined,
    workspaceId: 1,
    paneId: 'pane-1',
    ...overrides,
  };
}

describe('AggregateView - PTY Name Consistency', () => {
  describe('Issue 1: Title changes should not overwrite foregroundProcess', () => {
    it('should keep foregroundProcess separate from terminal title', () => {
      // Setup: Create a PTY with nvim as foreground process
      const pty1 = createMockPty({
        ptyId: 'pty-1',
        foregroundProcess: 'nvim',
        cwd: '/home/user/project-a',
      });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
        matchedPtys: [pty1],
        matchedPtysIndex: buildPtyIndex([pty1]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // When nvim sets its title to "main.rs"
      handleMetadataChange({ ptyId: 'pty-1', title: 'main.rs' });

      // Then: foregroundProcess should still be "nvim", not "main.rs"
      expect(state.allPtys[0].foregroundProcess).toBe('nvim');
      // And: title should be "main.rs"
      expect(state.allPtys[0].title).toBe('main.rs');
    });

    it('should display process name, not title, in aggregate view cards', () => {
      const pty1 = createMockPty({
        ptyId: 'pty-1',
        foregroundProcess: 'node',
        cwd: '/home/user/project-a',
      });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
        matchedPtys: [pty1],
        matchedPtysIndex: buildPtyIndex([pty1]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // Application sets title (different from process name)
      handleMetadataChange({ ptyId: 'pty-1', title: 'My Application v1.0' });

      // The card should still show "node" not "My Application v1.0"
      expect(state.allPtys[0].foregroundProcess).toBe('node');
    });

    it('should handle multiple PTYs with different titles independently', () => {
      const pty1 = createMockPty({
        ptyId: 'pty-1',
        foregroundProcess: 'nvim',
        cwd: '/home/user/project-a',
      });
      const pty2 = createMockPty({
        ptyId: 'pty-2',
        foregroundProcess: 'nvim',
        cwd: '/home/user/project-b',
      });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        matchedPtys: [pty1, pty2],
        matchedPtysIndex: buildPtyIndex([pty1, pty2]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // PTY 1's nvim has file "main.rs" open
      handleMetadataChange({ ptyId: 'pty-1', title: 'main.rs' });
      // PTY 2's nvim has file "README.md" open
      handleMetadataChange({ ptyId: 'pty-2', title: 'README.md' });

      // Both should still show "nvim" as process
      expect(state.allPtys[0].foregroundProcess).toBe('nvim');
      expect(state.allPtys[1].foregroundProcess).toBe('nvim');

      // But their titles should be different
      expect(state.allPtys[0].title).toBe('main.rs');
      expect(state.allPtys[1].title).toBe('README.md');
    });
  });

  describe('Issue 2: Index map synchronization', () => {
    it('should validate ptyId matches before applying title update', () => {
      // Setup: Two PTYs with different processes
      const pty1 = createMockPty({
        ptyId: 'pty-1',
        foregroundProcess: 'bash',
        cwd: '/home/user/project-a',
      });
      const pty2 = createMockPty({
        ptyId: 'pty-2',
        foregroundProcess: 'nvim',
        cwd: '/home/user/project-b',
      });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        matchedPtys: [pty1, pty2],
        matchedPtysIndex: buildPtyIndex([pty1, pty2]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // Simulate stale index: manually corrupt the index to point to wrong PTY
      setState(
        produce((s) => {
          s.allPtysIndex.set('pty-1', 1); // Wrong! pty-1 is at index 0
          s.matchedPtysIndex.set('pty-1', 1); // Wrong!
        })
      );

      // Now when pty-1's title changes
      handleMetadataChange({ ptyId: 'pty-1', title: 'should-not-apply-to-pty2' });

      // The update should be rejected or pty-2 should not be affected
      // Since ptyId at index 1 doesn't match "pty-1", no update should occur
      // OR the system should detect the mismatch and not apply the update
      const pty1InArray = state.allPtys.find((p) => p.ptyId === 'pty-1');
      const pty2InArray = state.allPtys.find((p) => p.ptyId === 'pty-2');

      // pty-2's process should remain "nvim", not "should-not-apply-to-pty2"
      expect(pty2InArray?.foregroundProcess).toBe('nvim');
    });

    it('should maintain index consistency when PTYs are added/removed', () => {
      let pty1 = createMockPty({ ptyId: 'pty-1', foregroundProcess: 'bash' });
      let pty2 = createMockPty({ ptyId: 'pty-2', foregroundProcess: 'nvim' });
      let pty3 = createMockPty({ ptyId: 'pty-3', foregroundProcess: 'node' });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1, pty2, pty3],
        allPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
        matchedPtys: [pty1, pty2, pty3],
        matchedPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // Remove middle PTY (simulating PTY destruction)
      setState(
        produce((s) => {
          s.allPtys = s.allPtys.filter((p) => p.ptyId !== 'pty-2');
          // Intentionally NOT rebuilding index to simulate bug
        })
      );

      // Now the index is stale: pty-3's index is still 2, but it's now at position 1

      // Send title update for pty-3
      handleMetadataChange({ ptyId: 'pty-3', title: 'new-title' });

      // Should either rebuild index automatically or validate before update
      // pty-1 should NOT receive pty-3's update
      const pty1InArray = state.allPtys.find((p) => p.ptyId === 'pty-1');
      expect(pty1InArray?.foregroundProcess).toBe('bash');
    });

    it('should handle rapid PTY lifecycle changes without index corruption', () => {
      const ptys: PtyInfo[] = [];
      for (let i = 0; i < 10; i++) {
        ptys.push(
          createMockPty({
            ptyId: `pty-${i}`,
            foregroundProcess: `process-${i}`,
          })
        );
      }

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        matchedPtys: ptys,
        matchedPtysIndex: buildPtyIndex(ptys),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // Simulate rapid lifecycle: remove multiple PTYs at once
      setState(
        produce((s) => {
          s.allPtys = s.allPtys.filter((_, idx) => idx % 2 === 0); // Keep even indices
          // Bug: index map not rebuilt - this makes indices stale
        })
      );

      // Send updates to remaining PTYs
      const remainingEvenIndices = [0, 2, 4, 6, 8];
      remainingEvenIndices.forEach((idx) => {
        handleMetadataChange({ ptyId: `pty-${idx}`, title: `title-${idx}` });
      });

      // With stale indices, some updates may be rejected to prevent cross-contamination
      // The important thing is that no PTY gets the wrong title
      // PTY 0 is at index 0 (correct) - update should succeed
      expect(state.allPtys.find((p) => p.ptyId === 'pty-0')?.title).toBe('title-0');

      // Verify no cross-contamination occurred - no PTY has another PTY's title
      const titles = state.allPtys.map((p) => p.title).filter((t) => t !== undefined);
      const uniqueTitles = [...new Set(titles)];
      expect(uniqueTitles.length).toBe(titles.length); // All titles should be unique
    });
  });

  describe('Integration: Both issues combined', () => {
    it('should handle title updates correctly even with index issues', () => {
      const pty1 = createMockPty({
        ptyId: 'pty-1',
        foregroundProcess: 'nvim',
        cwd: '/project/a',
      });
      const pty2 = createMockPty({
        ptyId: 'pty-2',
        foregroundProcess: 'nvim',
        cwd: '/project/b',
      });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        matchedPtys: [pty1, pty2],
        matchedPtysIndex: buildPtyIndex([pty1, pty2]),
      });

      const handleMetadataChange = createMetadataChangeHandler(setState);

      // Corrupt the index - make pty-1's index point to pty-2's position
      setState(
        produce((s) => {
          s.allPtysIndex.set('pty-1', 1); // Wrong! pty-1 is at index 0
          s.matchedPtysIndex.set('pty-1', 1); // Wrong!
        })
      );

      // Both nvims set their titles
      handleMetadataChange({ ptyId: 'pty-1', title: 'file-a.txt' });
      handleMetadataChange({ ptyId: 'pty-2', title: 'file-b.txt' });

      // Both processes should still be nvim (not overwritten)
      expect(state.allPtys.find((p) => p.ptyId === 'pty-1')?.foregroundProcess).toBe('nvim');
      expect(state.allPtys.find((p) => p.ptyId === 'pty-2')?.foregroundProcess).toBe('nvim');

      // With stale index, pty-1's update should be rejected (ptyId validation fails)
      // pty-2's update should succeed (index 1 is correct for pty-2)
      expect(state.allPtys.find((p) => p.ptyId === 'pty-1')?.title).toBeUndefined();
      expect(state.allPtys.find((p) => p.ptyId === 'pty-2')?.title).toBe('file-b.txt');
    });
  });
});
