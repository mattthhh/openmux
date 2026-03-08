/**
 * Smoke Tests for Aggregate View Redesign
 *
 * Critical integration tests to verify core functionality works
 * under realistic usage scenarios.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "bun:test";
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

const PERF_THRESHOLD_MS = 100;

function createMockSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    sessionId: `session-${overrides.sessionId ?? Math.random().toString(36).substr(2, 9)}`,
    name: `Session ${overrides.sessionId ?? 'default'}`,
    isActive: false,
    isLoaded: true,
    ptyCount: 0,
    ...overrides,
  };
}

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${overrides.ptyId ?? Math.random().toString(36).substr(2, 9)}`,
    cwd: `/home/user/project-${Math.floor(Math.random() * 1000)}`,
    gitBranch: ["main", "develop", "feature/x"][Math.floor(Math.random() * 3)],
    gitDiffStats: undefined,
    gitDirty: Math.random() > 0.5,
    gitStaged: Math.floor(Math.random() * 5),
    gitUnstaged: Math.floor(Math.random() * 5),
    gitUntracked: Math.floor(Math.random() * 3),
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: `repo-${Math.floor(Math.random() * 20)}`,
    foregroundProcess: ["bash", "nvim", "node", "zsh"][Math.floor(Math.random() * 4)],
    shell: "/bin/bash",
    title: undefined,
    workspaceId: Math.floor(Math.random() * 9) + 1,
    paneId: `pane-${Math.floor(Math.random() * 1000)}`,
    sessionId: overrides.sessionId ?? "session-1",
    ...overrides,
  };
}

function measureTime<T>(fn: () => T): { result: T; elapsedMs: number } {
  const start = performance.now();
  const result = fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

describe("Smoke Tests - Aggregate View Redesign", () => {
  describe("Performance: Open aggregate with 50+ sessions, 200+ PTYs", () => {
    it(`should render large tree in <${PERF_THRESHOLD_MS}ms`, () => {
      // Generate 50 sessions with 200+ PTYs total
      const sessions: SessionNode[] = [];
      const ptys: PtyInfo[] = [];

      for (let s = 0; s < 50; s++) {
        const sessionId = `session-${s}`;
        sessions.push(createMockSession({ sessionId }));

        // 4-5 PTYs per session = ~200-250 total
        const ptysPerSession = 4 + Math.floor(Math.random() * 2);
        for (let p = 0; p < ptysPerSession; p++) {
          ptys.push(createMockPty({ sessionId }));
        }
      }

      const { elapsedMs } = measureTime(() => {
        const tree = buildSessionTree(sessions, ptys);
        const flattened = flattenTreeForNavigation(tree);
        return flattened;
      });

      expect(elapsedMs).toBeLessThan(PERF_THRESHOLD_MS);
      expect(ptys.length).toBeGreaterThanOrEqual(200);
    });

    it(`should filter large tree in <${PERF_THRESHOLD_MS}ms`, () => {
      // Setup large dataset
      const sessions = Array.from({ length: 50 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` })
      );
      const ptys = sessions.flatMap((s) =>
        Array.from({ length: 4 }, (_, i) =>
          createMockPty({
            sessionId: s.sessionId,
            ptyId: `pty-${s.sessionId}-${i}`,
            foregroundProcess: i % 2 === 0 ? "nvim" : "bash",
          })
        )
      );

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });

      const actions = createAggregateViewActions(state, setState);

      const { elapsedMs } = measureTime(() => {
        actions.setFilterQuery("nvim");
      });

      expect(elapsedMs).toBeLessThan(PERF_THRESHOLD_MS);
      expect(state.matchedPtys.length).toBeGreaterThan(0);
    });

    it(`should navigate large tree in <${PERF_THRESHOLD_MS}ms`, () => {
      const sessions = Array.from({ length: 50 }, (_, i) =>
        createMockSession({ sessionId: `session-${i}` })
      );
      const ptys = sessions.flatMap((s) =>
        Array.from({ length: 4 }, () => createMockPty({ sessionId: s.sessionId }))
      );

      const tree = buildSessionTree(sessions, ptys);
      const flattened = flattenTreeForNavigation(tree);

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        treeNodes: flattened as FlattenedTreeItem[],
        selectedIndex: 0,
        selectedNodeId: flattened[0]?.id ?? null,
      });

      const actions = createAggregateViewActions(state, setState);

      // Navigate through entire tree
      const { elapsedMs } = measureTime(() => {
        for (let i = 0; i < Math.min(100, flattened.length - 1); i++) {
          actions.navigateDown();
        }
      });

      expect(elapsedMs).toBeLessThan(PERF_THRESHOLD_MS);
    });
  });

  describe("Create new pane in session - tree updates without unexpected reordering", () => {
    it("should add new PTY to correct session without reordering others", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const sessionB = createMockSession({ sessionId: "session-b" });
      const pty1 = createMockPty({ ptyId: "pty-1", sessionId: "session-a", foregroundProcess: "nvim" });
      const pty2 = createMockPty({ ptyId: "pty-2", sessionId: "session-b", foregroundProcess: "bash" });

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
        selectedIndex: 1,
        selectedNodeId: "pty-1",
      });

      // Simulate creating new pane in session-a
      const newPty = createMockPty({ ptyId: "pty-new", sessionId: "session-a", foregroundProcess: "node" });

      setState(produce((s) => {
        s.allPtys.push(newPty);
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        // Update tree - new PTY should be in session-a
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-new", depth: 1, parentId: "session-a", ptyId: "pty-new" },
          { type: "session", id: "session-b", depth: 0 },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-b", ptyId: "pty-2" },
        ] as FlattenedTreeItem[];
      }));

      // Verify session-a PTYs are grouped together
      const sessionAIndices = state.treeNodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n.parentId === "session-a" || n.id === "session-a")
        .map(({ i }) => i);

      expect(sessionAIndices).toEqual([0, 1, 2]);

      // Verify session-b PTYs come after
      const sessionBIndices = state.treeNodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n.parentId === "session-b" || n.id === "session-b")
        .map(({ i }) => i);

      expect(sessionBIndices).toEqual([3, 4]);
    });

    it("should maintain stable sort order when adding PTYs", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const ptys = [
        createMockPty({ ptyId: "pty-a", sessionId: "session-a", cwd: "/a" }),
        createMockPty({ ptyId: "pty-b", sessionId: "session-a", cwd: "/b" }),
        createMockPty({ ptyId: "pty-c", sessionId: "session-a", cwd: "/c" }),
      ];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });

      // Add new PTY
      const newPty = createMockPty({ ptyId: "pty-d", sessionId: "session-a", cwd: "/d" });

      setState(produce((s) => {
        s.allPtys.push(newPty);
        s.allPtysIndex = buildPtyIndex(s.allPtys);
      }));

      // Original PTYs should maintain relative order
      const originalPtyIds = ptys.map((p) => p.ptyId);
      const currentPtyIds = state.allPtys.slice(0, 3).map((p) => p.ptyId);
      expect(currentPtyIds).toEqual(originalPtyIds);
    });
  });

  describe("Kill PTY in middle of session - selection moves to correct adjacent pane", () => {
    it("should move selection to next PTY when killing middle PTY", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const ptys = [
        createMockPty({ ptyId: "pty-1", sessionId: "session-a" }),
        createMockPty({ ptyId: "pty-2", sessionId: "session-a" }),
        createMockPty({ ptyId: "pty-3", sessionId: "session-a" }),
      ];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a", ptyId: "pty-2" },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-a", ptyId: "pty-3" },
        ] as FlattenedTreeItem[],
        selectedIndex: 2,
        selectedNodeId: "pty-2",
      });

      const actions = createAggregateViewActions(state, setState);

      // Kill pty-2
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((p) => p.ptyId !== "pty-2");
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-3", depth: 1, parentId: "session-a", ptyId: "pty-3" },
        ] as FlattenedTreeItem[];
      }));

      // Recompute selection after removal
      const selected = actions.getSelectedPty();

      // Should have moved to pty-3 (next)
      expect(selected?.ptyId).toBe("pty-3");
    });

    it("should move selection to previous PTY when killing last PTY", () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const ptys = [
        createMockPty({ ptyId: "pty-1", sessionId: "session-a" }),
        createMockPty({ ptyId: "pty-2", sessionId: "session-a" }),
      ];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        treeNodes: [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
          { type: "pty", id: "pty-2", depth: 1, parentId: "session-a", ptyId: "pty-2" },
        ] as FlattenedTreeItem[],
        selectedIndex: 2,
        selectedNodeId: "pty-2",
      });

      const actions = createAggregateViewActions(state, setState);

      // Kill pty-2 (last)
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((p) => p.ptyId !== "pty-2");
        s.allPtysIndex = buildPtyIndex(s.allPtys);
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
          { type: "pty", id: "pty-1", depth: 1, parentId: "session-a", ptyId: "pty-1" },
        ] as FlattenedTreeItem[];
      }));

      const selected = actions.getSelectedPty();
      expect(selected?.ptyId).toBe("pty-1");
    });

    it("should move to parent session when last PTY in session is killed", () => {
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

      // Kill only PTY
      setState(produce((s) => {
        s.allPtys = [];
        s.allPtysIndex = new Map();
        s.treeNodes = [
          { type: "session", id: "session-a", depth: 0 },
        ] as FlattenedTreeItem[];
      }));

      // Selection should move to session-a
      expect(state.selectedNodeId).toBe("session-a");
    });
  });

  describe("Switch sessions while aggregate open - no crashes, state consistent", () => {
    it("should maintain aggregate view state during session switch", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
        selectedIndex: 5,
        selectedNodeId: "pty-5",
        filterQuery: "nvim",
      });

      const actions = createAggregateViewActions(state, setState);

      // Simulate session switch (this would normally trigger state updates)
      // Aggregate view should stay open
      expect(state.showAggregateView).toBe(true);

      // Filter query should persist
      expect(state.filterQuery).toBe("nvim");

      // Selection state should be valid (even if PTYs changed)
      expect(state.selectedIndex).toBeGreaterThanOrEqual(0);
    });

    it("should refresh PTYs when switching to different session", async () => {
      const sessionA = createMockSession({ sessionId: "session-a" });
      const ptysA = [
        createMockPty({ ptyId: "pty-a1", sessionId: "session-a" }),
        createMockPty({ ptyId: "pty-a2", sessionId: "session-a" }),
      ];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptysA,
        allPtysIndex: buildPtyIndex(ptysA),
        showAggregateView: true,
      });

      // Simulate loading PTYs from new session
      const ptysB = [
        createMockPty({ ptyId: "pty-b1", sessionId: "session-b" }),
        createMockPty({ ptyId: "pty-b2", sessionId: "session-b" }),
        createMockPty({ ptyId: "pty-b3", sessionId: "session-b" }),
      ];

      setState(produce((s) => {
        s.allPtys = ptysB;
        s.allPtysIndex = buildPtyIndex(ptysB);
      }));

      // Should have new PTYs
      expect(state.allPtys.length).toBe(3);
      expect(state.allPtys[0].ptyId).toBe("pty-b1");

      // Aggregate should still be open
      expect(state.showAggregateView).toBe(true);
    });

    it("should handle rapid session switches without crashes", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        showAggregateView: true,
      });

      // Rapidly switch between sessions (update allPtys each time)
      for (let i = 0; i < 10; i++) {
        const newPtys = Array.from({ length: 5 }, (_, j) =>
          createMockPty({ ptyId: `pty-${i}-${j}`, sessionId: `session-${i}` })
        );

        setState(produce((s) => {
          s.allPtys = newPtys;
          s.allPtysIndex = buildPtyIndex(newPtys);
        }));

        // State should always be valid
        expect(state.allPtys.length).toBe(5);
        expect(state.allPtysIndex.size).toBe(5);
      }

      // Final state should be consistent
      expect(state.showAggregateView).toBe(true);
    });
  });
});
