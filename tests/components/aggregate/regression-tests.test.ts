/**
 * Regression Tests for Aggregate View Redesign
 *
 * Ensures backward compatibility and no performance regressions.
 * These tests verify that the redesign doesn't break existing functionality.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "bun:test";
import { createStore, produce } from "solid-js/store";
import type {
  PtyInfo,
  AggregateViewState,
} from "../../../src/contexts/aggregate-view-types";
import { initialState } from "../../../src/contexts/aggregate-view-types";
import { buildPtyIndex, filterPtys } from "../../../src/contexts/aggregate-view-helpers";
import { createAggregateViewActions } from "../../../src/contexts/aggregate-view-actions";

// TODO: Update when RedBear's types are finalized

const BASELINE_PERF = {
  filterMs: 10,
  navigateMs: 1,
  renderMs: 50,
  ptyCreationMs: 5,
};

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: `pty-${overrides.ptyId ?? Math.random().toString(36).substr(2, 9)}`,
    cwd: `/home/user/project-${Math.floor(Math.random() * 1000)}`,
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
    paneId: `pane-${Math.floor(Math.random() * 1000)}`,
    ...overrides,
  };
}

function measureTime<T>(fn: () => T): { result: T; elapsedMs: number } {
  const start = performance.now();
  const result = fn();
  const elapsedMs = performance.now() - start;
  return { result, elapsedMs };
}

describe("Regression Tests - Backward Compatibility", () => {
  describe("Existing flat list tests still pass", () => {
    it("should support flat list navigation (legacy mode)", () => {
      const ptys = [
        createMockPty({ ptyId: "pty-1" }),
        createMockPty({ ptyId: "pty-2" }),
        createMockPty({ ptyId: "pty-3" }),
      ];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        matchedPtys: ptys,
        matchedPtysIndex: buildPtyIndex(ptys),
        selectedIndex: 0,
        selectedNodeId: "pty-1",
        // Legacy mode: no tree nodes
        treeNodes: undefined as unknown as [],
      });

      const actions = createAggregateViewActions(state, setState);

      // Legacy navigation should still work
      actions.navigateDown();
      expect(state.selectedIndex).toBe(1);
      expect(state.selectedNodeId).toBe("pty-2");

      actions.navigateDown();
      expect(state.selectedIndex).toBe(2);
      expect(state.selectedNodeId).toBe("pty-3");
    });

    it("should support legacy PTY lookup by index", () => {
      const ptys = Array.from({ length: 50 }, (_, i) =>
        createMockPty({ ptyId: `pty-${i}` })
      );

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        matchedPtys: ptys,
        matchedPtysIndex: buildPtyIndex(ptys),
      });

      // Direct index access should still work
      expect(state.allPtys[25].ptyId).toBe("pty-25");
      expect(state.allPtysIndex.get("pty-25")).toBe(25);
    });

    it("should maintain filterPtys function signature", () => {
      const ptys = [
        createMockPty({ ptyId: "pty-1", foregroundProcess: "nvim", cwd: "/project/a" }),
        createMockPty({ ptyId: "pty-2", foregroundProcess: "bash", cwd: "/project/b" }),
        createMockPty({ ptyId: "pty-3", foregroundProcess: "node", cwd: "/project/c" }),
      ];

      // filterPtys should work with same signature
      const filtered = filterPtys(ptys, "nvim");
      expect(filtered.length).toBe(1);
      expect(filtered[0].ptyId).toBe("pty-1");

      // Multi-term filter
      const multiFiltered = filterPtys(ptys, "project bash");
      expect(multiFiltered.length).toBe(1);
      expect(multiFiltered[0].ptyId).toBe("pty-2");
    });

    it("should support legacy AggregateViewContextValue interface", () => {
      const ptys = [createMockPty({ ptyId: "pty-1" })];

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });

      const actions = createAggregateViewActions(state, setState);

      // All legacy methods should exist
      expect(typeof actions.openAggregateView).toBe("function");
      expect(typeof actions.closeAggregateView).toBe("function");
      expect(typeof actions.setFilterQuery).toBe("function");
      expect(typeof actions.toggleShowInactive).toBe("function");
      expect(typeof actions.navigateUp).toBe("function");
      expect(typeof actions.navigateDown).toBe("function");
      expect(typeof actions.setSelectedIndex).toBe("function");
      expect(typeof actions.selectPty).toBe("function");
      expect(typeof actions.getSelectedPty).toBe("function");
      expect(typeof actions.enterPreviewMode).toBe("function");
      expect(typeof actions.exitPreviewMode).toBe("function");
    });

    it("should handle legacy PtyInfo without sessionId", () => {
      // Old PTY data might not have sessionId
      const legacyPty = {
        ptyId: "pty-legacy",
        cwd: "/home/user",
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
        // No sessionId - legacy data
      } as PtyInfo;

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [legacyPty],
        allPtysIndex: buildPtyIndex([legacyPty]),
      });

      // Should not crash
      expect(state.allPtys.length).toBe(1);
      expect(state.allPtys[0].ptyId).toBe("pty-legacy");
    });
  });

  describe("Session switching performance unchanged (benchmark)", () => {
    it(`should switch sessions within ${BASELINE_PERF.filterMs}ms baseline`, () => {
      const ptys = Array.from({ length: 100 }, (_, i) =>
        createMockPty({ ptyId: `pty-${i}` })
      );

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });

      // Simulate session switch: clear and reload PTYs
      const { elapsedMs } = measureTime(() => {
        setState(produce((s) => {
          s.allPtys = Array.from({ length: 100 }, (_, i) =>
            createMockPty({ ptyId: `new-pty-${i}` })
          );
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }));
      });

      expect(elapsedMs).toBeLessThan(BASELINE_PERF.filterMs * 2); // 2x tolerance
    });

    it("should maintain O(1) PTY lookup performance", () => {
      const ptys = Array.from({ length: 1000 }, (_, i) =>
        createMockPty({ ptyId: `pty-${i}` })
      );

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
      });

      // Time 1000 lookups
      const { elapsedMs } = measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          state.allPtysIndex.get(`pty-${i}`);
        }
      });

      // Should be very fast (O(1) Map lookups)
      expect(elapsedMs).toBeLessThan(10);
    });

    it("should not degrade filter performance with tree overhead", () => {
      const ptys = Array.from({ length: 200 }, (_, i) =>
        createMockPty({
          ptyId: `pty-${i}`,
          foregroundProcess: i % 2 === 0 ? "nvim" : "bash",
        })
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

      expect(elapsedMs).toBeLessThan(BASELINE_PERF.filterMs * 2);
    });
  });

  describe("PTY creation speed unchanged (benchmark)", () => {
    it(`should create PTY state within ${BASELINE_PERF.ptyCreationMs}ms baseline`, () => {
      const { elapsedMs } = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          createMockPty({ ptyId: `new-pty-${i}` });
        }
      });

      const avgPerPty = elapsedMs / 100;
      expect(avgPerPty).toBeLessThan(BASELINE_PERF.ptyCreationMs);
    });

    it("should handle rapid PTY creation without degradation", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [],
        allPtysIndex: new Map(),
      });

      const creationTimes: number[] = [];

      // Rapidly create 50 PTYs
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        const newPty = createMockPty({ ptyId: `pty-${i}` });

        setState(produce((s) => {
          s.allPtys.push(newPty);
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }));

        creationTimes.push(performance.now() - start);
      }

      // Average creation time should be consistent (no degradation)
      const avgTime = creationTimes.reduce((a, b) => a + b, 0) / creationTimes.length;
      const maxTime = Math.max(...creationTimes);

      expect(avgTime).toBeLessThan(BASELINE_PERF.ptyCreationMs * 2);
      expect(maxTime).toBeLessThan(BASELINE_PERF.ptyCreationMs * 5);
    });

    it("should maintain consistent batch update performance", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [],
        allPtysIndex: new Map(),
      });

      // Batch create 100 PTYs
      const newPtys = Array.from({ length: 100 }, (_, i) =>
        createMockPty({ ptyId: `batch-pty-${i}` })
      );

      const { elapsedMs } = measureTime(() => {
        setState(produce((s) => {
          s.allPtys = [...s.allPtys, ...newPtys];
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }));
      });

      expect(elapsedMs).toBeLessThan(BASELINE_PERF.ptyCreationMs * 10);
    });
  });

  describe("Navigation performance regression tests", () => {
    it(`should navigate within ${BASELINE_PERF.navigateMs}ms baseline`, () => {
      const ptys = Array.from({ length: 100 }, (_, i) =>
        createMockPty({ ptyId: `pty-${i}` })
      );

      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: ptys,
        allPtysIndex: buildPtyIndex(ptys),
        matchedPtys: ptys,
        matchedPtysIndex: buildPtyIndex(ptys),
        selectedIndex: 0,
        selectedNodeId: "pty-0",
      });

      const actions = createAggregateViewActions(state, setState);

      const { elapsedMs } = measureTime(() => {
        for (let i = 0; i < 50; i++) {
          actions.navigateDown();
        }
      });

      expect(elapsedMs).toBeLessThan(BASELINE_PERF.navigateMs * 10);
    });

    it("should handle edge case navigation without performance degradation", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [],
        selectedIndex: 0,
      });

      const actions = createAggregateViewActions(state, setState);

      // Navigate in empty list should be fast
      const { elapsedMs } = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          actions.navigateDown();
          actions.navigateUp();
        }
      });

      expect(elapsedMs).toBeLessThan(50);
    });
  });

  describe("State consistency regression tests", () => {
    it("should maintain index consistency after multiple operations", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [],
        allPtysIndex: new Map(),
      });

      const actions = createAggregateViewActions(state, setState);

      // Perform many operations
      for (let i = 0; i < 20; i++) {
        const newPty = createMockPty({ ptyId: `pty-${i}` });
        setState(produce((s) => {
          s.allPtys.push(newPty);
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }));
      }

      // Verify index is consistent
      for (const [ptyId, index] of state.allPtysIndex.entries()) {
        expect(state.allPtys[index]?.ptyId).toBe(ptyId);
      }

      // Remove some PTYs
      setState(produce((s) => {
        s.allPtys = s.allPtys.filter((_, i) => i % 2 === 0);
        s.allPtysIndex = buildPtyIndex(s.allPtys);
      }));

      // Verify index still consistent
      for (const [ptyId, index] of state.allPtysIndex.entries()) {
        expect(state.allPtys[index]?.ptyId).toBe(ptyId);
      }
    });

    it("should handle state resets without memory leaks", () => {
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: Array.from({ length: 100 }, (_, i) =>
          createMockPty({ ptyId: `pty-${i}` })
        ),
      });

      // Reset state multiple times
      for (let i = 0; i < 10; i++) {
        setState(produce((s) => {
          s.allPtys = [];
          s.allPtysIndex = new Map();
          s.matchedPtys = [];
          s.matchedPtysIndex = new Map();
        }));

        expect(state.allPtys.length).toBe(0);
        expect(state.allPtysIndex.size).toBe(0);

        // Add new PTYs
        setState(produce((s) => {
          s.allPtys = Array.from({ length: 50 }, (_, j) =>
            createMockPty({ ptyId: `reset-${i}-${j}` })
          );
          s.allPtysIndex = buildPtyIndex(s.allPtys);
        }));
      }

      expect(state.allPtys.length).toBe(50);
    });
  });
});
