/**
 * Litmus Tests: Git Metadata Stability
 * 
 * Verifies that git metadata doesn't flicker on updates (no clearing/popping).
 * Critical for preventing visual jank when git status updates.
 */
import { describe, expect, it, vi, beforeEach } from "bun:test";
import { createStore, produce } from "solid-js/store";
import type { 
  PtyInfo, 
  AggregateViewState,
  GitDiffStats 
} from "../../../src/contexts/aggregate-view-types";
import { initialState } from "../../../src/contexts/aggregate-view-types";
import { buildPtyIndex } from "../../../src/contexts/aggregate-view-helpers";
import { createBatchGitUpdater } from "../../../src/contexts/aggregate-view-git-updater";

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${overrides.ptyId ?? Math.random().toString(36).substr(2, 9)}`,
    cwd: "/home/user/project",
    gitBranch: "main",
    gitDiffStats: { added: 5, removed: 3, binary: 0 },
    gitDirty: true,
    gitStaged: 2,
    gitUnstaged: 3,
    gitUntracked: 1,
    gitConflicted: 0,
    gitAhead: 2,
    gitBehind: 1,
    gitStashCount: 0,
    gitState: "dirty",
    gitDetached: false,
    gitRepoKey: "repo-1",
    foregroundProcess: "nvim",
    shell: "/bin/bash",
    title: undefined,
    workspaceId: 1,
    paneId: "pane-1",
    ...overrides,
  };
}

describe("Git Metadata Stability - Litmus Tests", () => {
  describe("Git metadata doesn't flicker on updates (no clearing/popping)", () => {
    it("should preserve git metadata during batch updates", () => {
      const pty1 = createMockPty({ ptyId: "pty-1", gitRepoKey: "repo-1" });
      const pty2 = createMockPty({ ptyId: "pty-2", gitRepoKey: "repo-1" });
      const pty3 = createMockPty({ ptyId: "pty-3", gitRepoKey: "repo-2" });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2, pty3],
        allPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
        matchedPtys: [pty1, pty2, pty3],
        matchedPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
      });
      
      const batchUpdater = createBatchGitUpdater(setState);
      
      // Initial state - all PTYs have git data
      expect(state.allPtys[0].gitBranch).toBe("main");
      expect(state.allPtys[0].gitDiffStats).toEqual({ added: 5, removed: 3, binary: 0 });
      expect(state.allPtys[1].gitBranch).toBe("main");
      expect(state.allPtys[2].gitBranch).toBe("main");
      
      // Simulate batch update for repo-1
      const newDiffStats: GitDiffStats = { added: 10, removed: 5, binary: 1 };
      batchUpdater.updateByRepoKey("repo-1", {
        diffStats: newDiffStats,
        staged: 5,
        unstaged: 2,
      });
      
      // Verify repo-1 PTYs updated
      expect(state.allPtys[0].gitDiffStats).toEqual(newDiffStats);
      expect(state.allPtys[0].gitStaged).toBe(5);
      expect(state.allPtys[1].gitDiffStats).toEqual(newDiffStats);
      expect(state.allPtys[1].gitStaged).toBe(5);
      
      // Verify repo-2 PTY unchanged
      expect(state.allPtys[2].gitDiffStats).toEqual({ added: 5, removed: 3, binary: 0 });
      expect(state.allPtys[2].gitStaged).toBe(2);
    });

    it("should not clear git metadata before applying updates", () => {
      const pty1 = createMockPty({ ptyId: "pty-1", gitRepoKey: "repo-1" });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
      });
      
      // Track intermediate states during update
      const intermediateStates: Array<Partial<PtyInfo>> = [];
      
      const originalSetState = setState;
      const instrumentedSetState = (fn: any) => {
        // Capture state before update
        const beforeUpdate = { 
          gitBranch: state.allPtys[0]?.gitBranch,
          gitDiffStats: state.allPtys[0]?.gitDiffStats,
        };
        intermediateStates.push(beforeUpdate);
        
        originalSetState(fn);
        
        // Capture state after update
        const afterUpdate = {
          gitBranch: state.allPtys[0]?.gitBranch,
          gitDiffStats: state.allPtys[0]?.gitDiffStats,
        };
        intermediateStates.push(afterUpdate);
      };
      
      const batchUpdater = createBatchGitUpdater(instrumentedSetState);
      
      // Trigger update
      batchUpdater.updateByRepoKey("repo-1", {
        diffStats: { added: 20, removed: 10, binary: 0 },
      });
      
      // Verify no intermediate state had cleared metadata
      for (const snapshot of intermediateStates) {
        expect(snapshot.gitBranch).not.toBeUndefined();
        expect(snapshot.gitBranch).not.toBeNull();
      }
    });

    it("should debounce diff stats updates to prevent flicker", async () => {
      vi.useFakeTimers();
      
      const pty1 = createMockPty({ ptyId: "pty-1", gitRepoKey: "repo-1" });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
      });
      
      const batchUpdater = createBatchGitUpdater(setState, { debounceMs: 500 });
      
      // Trigger multiple rapid updates
      batchUpdater.updateByRepoKey("repo-1", { diffStats: { added: 1, removed: 0, binary: 0 } });
      batchUpdater.updateByRepoKey("repo-1", { diffStats: { added: 2, removed: 1, binary: 0 } });
      batchUpdater.updateByRepoKey("repo-1", { diffStats: { added: 3, removed: 1, binary: 0 } });
      batchUpdater.updateByRepoKey("repo-1", { diffStats: { added: 4, removed: 2, binary: 0 } });
      
      // Immediately after rapid updates, value should still be original
      expect(state.allPtys[0].gitDiffStats?.added).toBe(5);
      
      // Advance past debounce
      vi.advanceTimersByTime(500);
      
      // Now should have final value (last update wins)
      expect(state.allPtys[0].gitDiffStats?.added).toBe(4);
      
      vi.useRealTimers();
    });

    it("should update all panes in same repo together atomically", () => {
      const pty1 = createMockPty({ ptyId: "pty-1", gitRepoKey: "repo-1", cwd: "/project/a" });
      const pty2 = createMockPty({ ptyId: "pty-2", gitRepoKey: "repo-1", cwd: "/project/b" });
      const pty3 = createMockPty({ ptyId: "pty-3", gitRepoKey: "repo-1", cwd: "/project/c" });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2, pty3],
        allPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
      });
      
      let updateCount = 0;
      const trackedSetState = (fn: any) => {
        updateCount++;
        setState(fn);
      };
      
      const batchUpdater = createBatchGitUpdater(trackedSetState);
      
      // Update all 3 PTYs in same repo
      batchUpdater.updateByRepoKey("repo-1", {
        diffStats: { added: 100, removed: 50, binary: 0 },
        dirty: true,
      });
      
      // Should happen in single update, not 3 separate updates
      expect(updateCount).toBe(1);
      
      // All PTYs should have new values
      expect(state.allPtys[0].gitDiffStats?.added).toBe(100);
      expect(state.allPtys[1].gitDiffStats?.added).toBe(100);
      expect(state.allPtys[2].gitDiffStats?.added).toBe(100);
    });

    it("should not cause git metadata inheritance bug (wrong repo)", () => {
      // Setup: PTYs from different repos
      const pty1 = createMockPty({ 
        ptyId: "pty-1", 
        gitRepoKey: "repo-a",
        gitBranch: "feature-a",
        cwd: "/project/a" 
      });
      const pty2 = createMockPty({ 
        ptyId: "pty-2", 
        gitRepoKey: "repo-b",
        gitBranch: "feature-b", 
        cwd: "/project/b" 
      });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
      });
      
      const batchUpdater = createBatchGitUpdater(setState);
      
      // Update repo-a
      batchUpdater.updateByRepoKey("repo-a", {
        gitBranch: "main",
        diffStats: { added: 10, removed: 0, binary: 0 },
      });
      
      // Verify pty1 updated
      expect(state.allPtys[0].gitBranch).toBe("main");
      expect(state.allPtys[0].gitDiffStats?.added).toBe(10);
      
      // Verify pty2 unchanged (not affected by repo-a update)
      expect(state.allPtys[1].gitBranch).toBe("feature-b");
      expect(state.allPtys[1].gitDiffStats?.added).toBe(5);
    });

    it("should handle PTY switching repos gracefully", () => {
      const pty1 = createMockPty({ 
        ptyId: "pty-1", 
        gitRepoKey: "repo-a",
        gitBranch: "main",
        cwd: "/project/a" 
      });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
      });
      
      // Simulate PTY changing directory to different repo
      setState(produce((s) => {
        const pty = s.allPtys.find(p => p.ptyId === "pty-1");
        if (pty) {
          pty.gitRepoKey = "repo-b";
          pty.gitBranch = "develop";
          pty.cwd = "/project/b";
        }
      }));
      
      const batchUpdater = createBatchGitUpdater(setState);
      
      // Update old repo - should not affect pty1 anymore
      batchUpdater.updateByRepoKey("repo-a", {
        gitBranch: "old-repo-update",
      });
      
      expect(state.allPtys[0].gitBranch).toBe("develop");
      
      // Update new repo - should affect pty1
      batchUpdater.updateByRepoKey("repo-b", {
        gitBranch: "new-repo-update",
      });
      
      expect(state.allPtys[0].gitBranch).toBe("new-repo-update");
    });
  });

  describe("Git metadata caching and performance", () => {
    it("should not query git status for unchanged repos", () => {
      const gitQueryMock = vi.fn();
      
      const pty1 = createMockPty({ ptyId: "pty-1", gitRepoKey: "repo-1" });
      const pty2 = createMockPty({ ptyId: "pty-2", gitRepoKey: "repo-1" });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
      });
      
      const batchUpdater = createBatchGitUpdater(setState, {
        queryGitStatus: gitQueryMock,
        cacheTimeoutMs: 5000,
      });
      
      // First query
      batchUpdater.refreshRepo("repo-1");
      expect(gitQueryMock).toHaveBeenCalledTimes(1);
      
      // Immediate second query - should use cache
      batchUpdater.refreshRepo("repo-1");
      expect(gitQueryMock).toHaveBeenCalledTimes(1); // No additional call
    });

    it("should batch git queries by repo to prevent N+1", async () => {
      const gitQueryMock = vi.fn().mockResolvedValue({
        branch: "main",
        diffStats: { added: 5, removed: 2, binary: 0 },
      });
      
      // 10 PTYs, 2 repos (5 each)
      const ptys = Array.from({ length: 10 }, (_, i) => 
        createMockPty({ 
          ptyId: `pty-${i}`, 
          gitRepoKey: i < 5 ? "repo-1" : "repo-2",
        })
      );
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });
      
      const batchUpdater = createBatchGitUpdater(setState, {
        queryGitStatus: gitQueryMock,
      });
      
      // Refresh all repos
      await batchUpdater.refreshAllRepos();
      
      // Should only query 2 repos, not 10 PTYs
      expect(gitQueryMock).toHaveBeenCalledTimes(2);
      expect(gitQueryMock).toHaveBeenCalledWith("repo-1");
      expect(gitQueryMock).toHaveBeenCalledWith("repo-2");
    });
  });
});
