/**
 * Litmus Tests: Tree Navigation Order
 * 
 * Verifies that navigation order matches visual tree order exactly.
 * Critical for the hierarchical session tree redesign.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { createStore, produce } from "solid-js/store";
import type { 
  PtyInfo, 
  SessionNode,
  TreeNode,
  AggregateViewState 
} from "../../../src/contexts/aggregate-view-types";
import { initialState } from "../../../src/contexts/aggregate-view-types";
import {
  buildPtyIndex,
  buildSessionTree,
  flattenTreeForNavigation,
  getVisualOrder,
} from "../../../src/contexts/aggregate-view-helpers";
import { createAggregateViewActions } from "../../../src/contexts/aggregate-view-actions";

// Mock session and PTY data for tree structure
function createMockSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: `session-${Math.random().toString(36).substr(2, 9)}`,
    name: `Session ${overrides.sessionId ?? 'default'}`,
    isActive: false,
    isLoaded: true,
    ptyCount: 0,
    ...overrides,
  };
}

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${Math.random().toString(36).substr(2, 9)}`,
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

describe("Tree Navigation - Litmus Tests", () => {
  describe("Navigation order matches visual order exactly", () => {
    it("should navigate through tree in depth-first order", () => {
      // Setup: Create tree structure
      // Session A
      //   ├─ PTY 1
      //   └─ PTY 2
      // Session B
      //   ├─ PTY 3
      //   ├─ PTY 4
      //   └─ PTY 5
      
      const sessionA = createMockSession({ sessionId: "session-a", name: "Project A" });
      const sessionB = createMockSession({ sessionId: "session-b", name: "Project B" });
      
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a", cwd: "/project/a/1" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a", cwd: "/project/a/2" });
      const pty3 = createMockPty({ ptyId: "pty-3", sessionId: "session-b", cwd: "/project/b/1" });
      const pty4 = createMockPty({ ptyId: "pty-4", sessionId: "session-b", cwd: "/project/b/2" });
      const pty5 = createMockPty({ ptyId: "pty-5", sessionId: "session-b", cwd: "/project/b/3" });
      
      const ptys = [pty1, pty2, pty3, pty4, pty5];
      const sessions = [sessionA, sessionB];
      
      // Build tree and flatten for navigation
      const tree = buildSessionTree(sessions, ptys);
      const flattened = flattenTreeForNavigation(tree);
      
      // Expected order: Session A, PTY 1, PTY 2, Session B, PTY 3, PTY 4, PTY 5
      expect(flattened.map(n => n.id)).toEqual([
        "session-a",
        "pty-1",
        "pty-2",
        "session-b",
        "pty-3",
        "pty-4",
        "pty-5",
      ]);
    });

    it("should maintain order when sessions have varying PTY counts", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const sessionB = createMockSession({ sessionId: "session-b" });
      const sessionC = createMockSession({ sessionId: "session-c" });
      
      // Session A: 1 PTY, Session B: 0 PTYs, Session C: 3 PTYs
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-c" });
      const pty3 = createMockPty({ ptyId: "pty-3", sessionId: "session-c" });
      const pty4 = createMockPty({ ptyId: "pty-4", sessionId: "session-c" });
      
      const ptys = [pty1, pty2, pty3, pty4];
      const sessions = [sessionA, sessionB, sessionC];
      
      const tree = buildSessionTree(sessions, ptys);
      const flattened = flattenTreeForNavigation(tree);
      
      // Expected: Session A, PTY 1, Session B (empty), Session C, PTY 2, PTY 3, PTY 4
      expect(flattened.map(n => n.id)).toEqual([
        "session-a",
        "pty-1",
        "session-b",
        "session-c",
        "pty-2",
        "pty-3",
        "pty-4",
      ]);
    });

    it("should update navigation order when tree structure changes", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a" });
      
      let ptys = [pty1, pty2];
      const sessions = [sessionA];
      
      // Initial order
      let tree = buildSessionTree(sessions, ptys);
      let flattened = flattenTreeForNavigation(tree);
      expect(flattened.map(n => n.id)).toEqual(["session-a", "pty-1", "pty-2"]);
      
      // Add new PTY in middle (simulating creation)
      const ptyNew = createMockPty({ ptyId: "pty-new", sessionId: "session-a" });
      ptys = [pty1, ptyNew, pty2];
      
      tree = buildSessionTree(sessions, ptys);
      flattened = flattenTreeForNavigation(tree);
      expect(flattened.map(n => n.id)).toEqual(["session-a", "pty-1", "pty-new", "pty-2"]);
    });

    it("should handle filtered tree navigation correctly", () => {
      const sessionA = createMockSession({ sessionId: "session-a", name: "Frontend" });
      const sessionB = createMockSession({ sessionId: "session-b", name: "Backend" });
      
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a", foregroundProcess: "nvim" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-a", foregroundProcess: "bash" });
      const pty3 = createMockPty({ ptyId: "pty-3", sessionId: "session-b", foregroundProcess: "nvim" });
      
      const ptys = [pty1, pty2, pty3];
      const sessions = [sessionA, sessionB];
      
      // Filter to only nvim processes
      const filteredPtys = ptys.filter(p => p.foregroundProcess === "nvim");
      const tree = buildSessionTree(sessions, filteredPtys);
      const flattened = flattenTreeForNavigation(tree);
      
      // Should only show nvim PTYs, maintaining tree structure
      expect(flattened.map(n => n.id)).toEqual([
        "session-a",
        "pty-1",
        "session-b",
        "pty-3",
      ]);
    });
  });

  describe("Navigation actions follow visual order", () => {
    it("should navigate down through tree in visual order", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a" },
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-b" },
        ],
        selectedIndex: 0,
        selectedNodeId: "session-a",
      });
      
      const actions = createAggregateViewActions(state, setState);
      
      // Navigate down through tree
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("pty-1");
      
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("pty-2");
      
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("session-b");
      
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("pty-3");
    });

    it("should navigate up through tree in reverse visual order", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a" },
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-b" },
        ],
        selectedIndex: 3,
        selectedNodeId: "pty-2",
      });
      
      const actions = createAggregateViewActions(state, setState);
      
      actions.navigateUp();
      expect(state.selectedNodeId).toBe("session-b");
      
      actions.navigateUp();
      expect(state.selectedNodeId).toBe("pty-1");
      
      actions.navigateUp();
      expect(state.selectedNodeId).toBe("session-a");
    });

    it("should skip collapsed session children when navigating", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        treeNodes: [
          { type: "session", id: "session-a", depth: 0, expanded: true },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a" },
          { type: "session", id: "session-b", depth: 0, expanded: false },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-b", hidden: true },
          { type: "session", id: "session-c", depth: 0, expanded: true },
        ],
        selectedIndex: 2, // PTY-2
        selectedNodeId: "pty-2",
      });
      
      const actions = createAggregateViewActions(state, setState);
      
      // Navigate down - should skip hidden PTY-3 and go to session-c
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("session-b");
      
      actions.navigateDown();
      expect(state.selectedNodeId).toBe("session-c");
    });
  });

  describe("Tree prefix rendering matches visual structure", () => {
    it("should generate correct tree prefixes for rendering", () => {
      const sessions = [
        createMockSession({ sessionId: "s1" }),
        createMockSession({ sessionId: "s2" }),
      ];
      const ptys = [
        createMockPty({ ptyId: "p1", sessionId: "s1" }),
        createMockPty({ ptyId: "p2", sessionId: "s1" }),
        createMockPty({ ptyId: "p3", sessionId: "s2" }),
      ];
      
      const tree = buildSessionTree(sessions, ptys);
      const visualOrder = getVisualOrder(tree);
      
      // Session 1: root node
      expect(visualOrder[0].prefix).toBe("");
      expect(visualOrder[0].isLast).toBe(false);
      
      // PTY 1: first child, not last
      expect(visualOrder[1].prefix).toBe("├─ ");
      expect(visualOrder[1].depth).toBe(1);
      
      // PTY 2: last child of session 1
      expect(visualOrder[2].prefix).toBe("└─ ");
      expect(visualOrder[2].depth).toBe(1);
      expect(visualOrder[2].isLast).toBe(true);
      
      // Session 2: root node, last
      expect(visualOrder[3].prefix).toBe("");
      expect(visualOrder[3].isLast).toBe(true);
      
      // PTY 3: only child of session 2
      expect(visualOrder[4].prefix).toBe("└─ ");
      expect(visualOrder[4].depth).toBe(1);
    });

    it("should handle deeply nested visual structure", () => {
      // 3 levels deep structure
      const sessions = [createMockSession({ sessionId: "s1" })];
      const ptys = [
        createMockPty({ ptyId: "p1", sessionId: "s1" }),
        createMockPty({ ptyId: "p2", sessionId: "s1" }),
        createMockPty({ ptyId: "p3", sessionId: "s1" }),
      ];
      
      const tree = buildSessionTree(sessions, ptys);
      const visualOrder = getVisualOrder(tree);
      
      // Check depth is correctly assigned
      expect(visualOrder[0].depth).toBe(0); // Session
      expect(visualOrder[1].depth).toBe(1); // PTY 1
      expect(visualOrder[2].depth).toBe(1); // PTY 2
      expect(visualOrder[3].depth).toBe(1); // PTY 3
    });
  });
});
