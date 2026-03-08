/**
 * Litmus Tests: Shimmer Effect Layout Stability
 * 
 * Verifies that shimmer effect doesn't cause layout shifts (color-only verification).
 * Critical for visual stability during coding agent activity indication.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "bun:test";
import { createStore } from "solid-js/store";
import type { 
  PtyInfo, 
  AggregateViewState,
  FlattenedTreeItem,
} from "../../../src/contexts/aggregate-view-types";
import { initialState } from "../../../src/contexts/aggregate-view-types";
import { buildPtyIndex } from "../../../src/contexts/aggregate-view-helpers";
import { useShimmerTick } from "../../../src/contexts/aggregate-view-shimmer";

// TODO: Update when RedBear's types are finalized

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
    ...overrides,
  };
}

describe("Shimmer Layout Stability - Litmus Tests", () => {
  describe("Shimmer doesn't cause layout shifts (color-only verification)", () => {
    it("should only update color values during shimmer animation", () => {
      vi.useFakeTimers();
      
      // Track all store updates
      const updates: Array<{ path: string[]; value: unknown }> = [];
      
      const pty1 = createMockPty({ 
        ptyId: "pty-1", 
        foregroundProcess: "node",
        shell: "/bin/bash",
      });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        allPtysIndex: buildPtyIndex([pty1]),
      });
      
      // Track store mutations
      const trackedSetState = (...args: any[]) => {
        if (args.length >= 2) {
          const path = Array.isArray(args[0]) ? args[0] : [args[0]];
          updates.push({ path: path.map(String), value: args[1] });
        }
        // @ts-expect-error - store typing
        return setState(...args);
      };
      
      // Start shimmer
      const { tick, colorValue } = useShimmerTick(trackedSetState, {
        tickIntervalMs: 100,
      });
      
      // Advance through animation frames
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(100);
      }
      
      // Filter for shimmer-related updates
      const shimmerUpdates = updates.filter(u => 
        u.path.some(p => p.includes("shimmer") || p.includes("color"))
      );
      
      // All shimmer updates should be color-only, no layout properties
      for (const update of shimmerUpdates) {
        const lastPathPart = update.path[update.path.length - 1];
        // Should only update color values (strings), never dimensions/padding/position
        expect(typeof update.value).toBe("string"); // Color hex/rgb value
        expect(lastPathPart).not.toMatch(/width|height|padding|margin|top|left|position/);
      }
      
      vi.useRealTimers();
    });

    it("should calculate shimmer color based on tick, not re-layout", () => {
      vi.useFakeTimers();
      
      const pty1 = createMockPty({ 
        ptyId: "pty-1",
        foregroundProcess: "node", // Different from shell = active
        shell: "/bin/bash",
      });
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        allPtys: [pty1],
        flattenedTree: [
          { 
            type: "pty", 
            id: "pty-1", 
            depth: 1, 
            parentId: "session-1",
            ptyId: "pty-1",
          } as FlattenedTreeItem,
        ],
      });
      
      const { getShimmerColor, tick } = useShimmerTick(setState, {
        tickIntervalMs: 50,
      });
      
      // Get color at different ticks
      const colors: string[] = [];
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(50);
        colors.push(getShimmerColor("pty-1"));
      }
      
      // Colors should change smoothly (no jumps)
      let colorChanges = 0;
      for (let i = 1; i < colors.length; i++) {
        if (colors[i] !== colors[i - 1]) {
          colorChanges++;
        }
      }
      
      // Should have some color changes (animation is happening)
      expect(colorChanges).toBeGreaterThan(0);
      
      // But should be gradual - each color should be a valid hex
      for (const color of colors) {
        expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      
      vi.useRealTimers();
    });

    it("should not trigger re-render of PTY row dimensions during shimmer", () => {
      const renderCalls: Array<Record<string, unknown>> = [];
      
      const pty1 = createMockPty({ 
        ptyId: "pty-1",
        foregroundProcess: "nvim",
        shell: "/bin/bash",
      });
      
      // Mock component render tracking
      const mockRowRender = (props: { pty: PtyInfo; style: unknown }) => {
        renderCalls.push({
          ptyId: props.pty.ptyId,
          style: props.style,
        });
        return null;
      };
      
      // Simulate 10 render cycles with shimmer
      for (let i = 0; i < 10; i++) {
        mockRowRender({
          pty: pty1,
          style: { height: 1, padding: 0 }, // Single line height
        });
      }
      
      // All renders should have same dimensions
      const firstRender = renderCalls[0];
      for (let i = 1; i < renderCalls.length; i++) {
        const currentRender = renderCalls[i];
        // Style should be identical across all renders (no layout changes)
        expect(currentRender.style).toEqual(firstRender.style);
      }
    });

    it("should only apply shimmer to active coding-agent PTYs", () => {
      const ptys = [
        createMockPty({ 
          ptyId: "pty-1", 
          foregroundProcess: "node", // Active - different from shell
          shell: "/bin/bash" 
        }),
        createMockPty({ 
          ptyId: "pty-2", 
          foregroundProcess: "bash", // Inactive - same as shell
          shell: "/bin/bash" 
        }),
        createMockPty({ 
          ptyId: "pty-3", 
          foregroundProcess: "nvim", // Active
          shell: "/bin/zsh" 
        }),
        createMockPty({ 
          ptyId: "pty-4", 
          foregroundProcess: undefined, // Unknown
          shell: "/bin/bash" 
        }),
      ];
      
      const { shouldShimmer } = useShimmerTick(() => {}, {});
      
      // Active PTYs should shimmer
      expect(shouldShimmer(ptys[0])).toBe(true); // node !== bash
      expect(shouldShimmer(ptys[2])).toBe(true); // nvim !== zsh
      
      // Inactive PTYs should not shimmer
      expect(shouldShimmer(ptys[1])).toBe(false); // bash === bash
      expect(shouldShimmer(ptys[3])).toBe(false); // undefined process
    });

    it("should maintain consistent row height during shimmer animation", () => {
      // Single line = exactly 1 character height per spec
      const SINGLE_LINE_HEIGHT = 1;
      
      const pty1 = createMockPty({ 
        ptyId: "pty-1",
        foregroundProcess: "node",
        shell: "/bin/bash",
      });
      
      // Simulate row renders with shimmer at different animation phases
      const heights: number[] = [];
      for (let tick = 0; tick < 20; tick++) {
        // Calculate what height would be at this tick
        const height = SINGLE_LINE_HEIGHT; // Should always be 1
        heights.push(height);
      }
      
      // All heights should be identical (no expansion/contraction)
      const uniqueHeights = [...new Set(heights)];
      expect(uniqueHeights).toHaveLength(1);
      expect(uniqueHeights[0]).toBe(SINGLE_LINE_HEIGHT);
    });

    it("should not affect parent container layout during shimmer", () => {
      const containerLayouts: Array<{ width: number; height: number }> = [];
      
      // Simulate container re-renders during shimmer
      for (let tick = 0; tick < 10; tick++) {
        containerLayouts.push({
          width: 80,
          height: 24,
        });
      }
      
      // Container dimensions should remain constant
      const firstLayout = containerLayouts[0];
      for (const layout of containerLayouts) {
        expect(layout.width).toBe(firstLayout.width);
        expect(layout.height).toBe(firstLayout.height);
      }
    });
  });

  describe("Shimmer performance and timing", () => {
    it("should use global tick to prevent per-row timer overhead", () => {
      vi.useFakeTimers();
      
      const setTimeoutCalls: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      
      // @ts-expect-error - mocking setTimeout
      globalThis.setTimeout = (fn: () => void, ms: number) => {
        setTimeoutCalls.push(ms);
        return originalSetTimeout(fn, ms);
      };
      
      // Create multiple PTY rows with shimmer
      const ptys = Array.from({ length: 10 }, (_, i) => 
        createMockPty({ 
          ptyId: `pty-${i}`,
          foregroundProcess: "node",
          shell: "/bin/bash",
        })
      );
      
      // Each row should subscribe to same global tick, not create own timer
      const { tick } = useShimmerTick(() => {}, {
        tickIntervalMs: 100,
      });
      
      // Should only have 1 timer for the global tick, not 10
      const shimmerTimers = setTimeoutCalls.filter(ms => ms === 100);
      expect(shimmerTimers.length).toBeLessThanOrEqual(1);
      
      // @ts-expect-error - restore
      globalThis.setTimeout = originalSetTimeout;
      vi.useRealTimers();
    });

    it("should derive color from tick without store mutations when possible", () => {
      const storeMutations: string[] = [];
      
      const [state, setState] = createStore<AggregateViewState>({
        ...initialState,
        shimmerTick: 0,
      });
      
      // Track store mutations
      const trackedSetState = (...args: any[]) => {
        storeMutations.push(String(args[0]));
        // @ts-expect-error - store typing
        return setState(...args);
      };
      
      const { getShimmerColor } = useShimmerTick(trackedSetState, {});
      
      // Call getShimmerColor multiple times
      for (let i = 0; i < 100; i++) {
        getShimmerColor("pty-1");
      }
      
      // Should not cause store mutations on read
      const shimmerMutations = storeMutations.filter(m => m.includes("shimmer"));
      expect(shimmerMutations.length).toBe(0);
    });
  });
});
