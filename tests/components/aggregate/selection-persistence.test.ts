/**
 * Litmus Tests: Selection Persistence
 *
 * Verifies that selection survives tree updates (structural changes).
 * Critical for maintaining user context during dynamic tree updates.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { createStore, produce } from "solid-js/store";
import type {
  PtyInfo,
  SessionNode,
  FlattenedTreeItem,
  AggregateViewState,
} from "../../../src/contexts/aggregate-view-types";
import { initialState } from "../../../src/contexts/aggregate-view-types";
import { buildPtyIndex, buildSessionTree, flattenTreeForNavigation } from "../../../src/contexts/aggregate-view-helpers";
import { createAggregateViewActions } from "../../../src/contexts/aggregate-view-actions";

// TODO: Update when RedBear's types are finalized

function createMockSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: `session-${overrides.sessionId ?? Math.random().toString(36).substr(2, 9)}`,
    name: `Session ${overrides.sessionId ?? "default"}`,
    isActive: false,
    isLoaded: true,
    ptyCount: 0,
    ...overrides,
  };
}

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${overrides.ptyId ?? Math.random().toString(36).substr(2, 9)}`,
    cwd: "/home/user/project",
    gitBranch: "main",
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
    foregroundProcess: "bash",
    shell: "/bin/bash",
    title: undefined,
    workspaceId: 1,
    paneId: "pane-1",
    sessionId: overrides.sessionId ?? "session-1",
    ...overrides,
  };
}

describe("Selection Persistence - Litmus Tests", () => {
  describe("Selection survives tree updates (structural changes)", () => {
    it("should maintain selection when new session is added", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
        matchedPtys: [pty1],
        matchedPtysIndex: buildPtyIndex([pty1]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
        ] as FlattenedTreeItem[],
        selectedIndex: 1,
        selectedNodeId: "pty-1",
      });

      const actions = createAggregateViewActions(state, setState);

      // Add new session with PTYs
      const sessionB = createMockSession({ sessionId: "session-b" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-b" });

      setState(produce((s) => {
        s.allPtys = [...s.allPtys, pty2];
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-b", ptyId: "pty-2" },
        ] as FlattenedTreeItem[];
      }));

      // Selection should still be on pty-1
      expect(state.selectedNodeId).toBe("pty-1");
      expect(state.selectedIndex).toBe(1);
    });

    it("should maintain selection when session is removed (if selection not in that session)", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const sessionB = createMockSession({ sessionId: "session-b" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-b" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-b", ptyId: "pty-2" },
        ] as FlattenedTreeItem[],
        selectedIndex: 3,
        selectedNodeId: "pty-2",
      });

      // Remove session-a (pty-1)
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((p) => p.sessionId !== "session-a");
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-b", ptyId: "pty-2" },
        ] as FlattenedTreeItem[];
      }));

      // Selection should still be on pty-2, but index should update to 1
      expect(state.selectedNodeId).toBe("pty-2");
      expect(state.selectedIndex).toBe(1);
    });

    it("should move to adjacent selection when selected PTY is removed", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a" });
      const pty3 = createMockPty({ ptyId: "pty-3", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2, pty3],
        allPtysIndex: buildPtyIndex([pty1, pty2, pty3]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a", ptyId: "pty-2" },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-a", ptyId: "pty-3" },
        ] as FlattenedTreeItem[],
        selectedIndex: 2, // pty-2
        selectedNodeId: "pty-2",
      });

      const actions = createAggregateViewActions(state, setState);

      // Remove pty-2 (middle)
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((p) => p.ptyId !== "pty-2");
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-a", ptyId: "pty-3" },
        ] as FlattenedTreeItem[];
      }));

      // Should smart-select: move to pty-3 (next) or pty-1 (previous)
      // Implementation detail: typically moves to next if available
      expect(state.selectedNodeId).toBe("pty-3");
      expect(state.selectedIndex).toBe(2);
    });

    it("should move to previous when last PTY is removed", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a", ptyId: "pty-2" },
        ] as FlattenedTreeItem[],
        selectedIndex: 2, // pty-2 (last)
        selectedNodeId: "pty-2",
      });

      // Remove pty-2
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((p) => p.ptyId !== "pty-2");
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
        ] as FlattenedTreeItem[];
      }));

      // Should move to pty-1
      expect(state.selectedNodeId).toBe("pty-1");
      expect(state.selectedIndex).toBe(1);
    });

    it("should handle removal of all PTYs gracefully", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
        ] as FlattenedTreeItem[],
        selectedIndex: 1,
        selectedNodeId: "pty-1",
      });

      // Remove all PTYs
      setState(produce((s) => {
        s.allPtys = [];
        s.allPtysIndex = new Map();
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
        ] as FlattenedTreeItem[];
      }));

      // Should clear selection
      expect(state.selectedNodeId).toBeNull();
      expect(state.selectedIndex).toBe(0);
    });

    it("should persist selection across filter changes", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a", foregroundProcess: "nvim" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a", foregroundProcess: "bash" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        matchedPtys: [pty1, pty2],
        matchedPtysIndex: buildPtyIndex([pty1, pty2]),
        showInactive: true,
        selectedIndex: 1,
        selectedNodeId: "pty-1",
      });

      const actions = createAggregateViewActions(state, setState);

      // Toggle to show only active (hides pty-2 bash, keeps pty-1 nvim)
      actions.toggleShowInactive();

      // Selection should remain on pty-1 (still visible)
      expect(state.selectedNodeId).toBe("pty-1");

      // Filter to only bash (hides pty-1 nvim)
      actions.setFilterQuery("bash");

      // Selection should move since pty-1 is filtered out
      expect(state.selectedNodeId).toBe("pty-2");
    });

    it("should persist selection when session expands/collapses", () => {
      const sessionA = createMockSession({ sessionId: "session-a", expanded: true });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        expandedSessionIds: new Set(["session-a"]),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0, expanded: true },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a", ptyId: "pty-2" },
        ] as FlattenedTreeItem[],
        selectedIndex: 2,
        selectedNodeId: "pty-2",
      });

      const actions = createAggregateViewActions(state, setState);

      // Collapse session-a
      setState(produce((s) => {
        s.expandedSessionIds.delete("session-a");
        if (s.treeNodes[0] && s.treeNodes[0].type === "session") {
          s.treeNodes[0].expanded = false;
        }
        // Hide children in tree
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0, expanded: false },
        ] as FlattenedTreeItem[];
      }));

      // Selection should move to session-a since children are hidden
      expect(state.selectedNodeId).toBe("session-a");
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe("Selection state by ID not index", () => {
    it("should use ptyId as source of truth, not array index", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        selectedIndex: 2,
        selectedNodeId: "pty-2",
      });

      // Reorder PTYs (simulating sort change)
      setState(produce((s) => {
        s.allPtys = [pty2, pty1]; // Swap order
        s.allPtysIndex = buildPtyIndex(s.allPtys);
      }));

      // selectedNodeId should still be pty-2
      expect(state.selectedNodeId).toBe("pty-2");
      // Index should update to new position
      expect(state.selectedIndex).toBe(0);
    });

    it("should handle ptyId lookup when index is stale", () => {
      const pty1 = createMockPty({ ptyId: "pty-1" });
      const pty2 = createMockPty({ ptyId: "pty-2" });

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1, pty2],
        allPtysIndex: buildPtyIndex([pty1, pty2]),
        selectedIndex: 5, // Stale index (out of bounds)
        selectedNodeId: "pty-1",
      });

      const actions = createAggregateViewActions(state, setState);
      const selectedPty = actions.getSelectedPty();

      // Should find by ID despite stale index
      expect(selectedPty?.ptyId).toBe("pty-1");
    });
  });
});
