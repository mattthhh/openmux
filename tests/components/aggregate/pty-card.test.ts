/**
 * Tests for PtyCard diff stat rendering behavior.
 */
import { describe, expect, it } from "bun:test";
import { PtyCard } from "../../../src/components/aggregate/PtyCard";
import type { GitDiffStats, PtyInfo } from "../../../src/contexts/aggregate-view-types";
import { DEFAULT_THEME } from "../../../src/core/config";

function createPty(diffStatsGetter: () => GitDiffStats | undefined): PtyInfo {
  const pty: PtyInfo = {
    ptyId: "pty-1",
    cwd: "/tmp/openmux",
    gitBranch: "main",
    gitDiffStats: undefined,
    gitDirty: true,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: "repo-1",
    foregroundProcess: "bash",
    shell: "bash",
    title: undefined,
    workspaceId: 1,
    paneId: "pane-1",
  };

  Object.defineProperty(pty, "gitDiffStats", {
    configurable: true,
    enumerable: true,
    get: diffStatsGetter,
  });

  return pty;
}

describe("PtyCard", () => {
  it("does not throw if diff stats disappear between reads", () => {
    let calls = 0;
    const statsSequence: Array<GitDiffStats | undefined> = [
      { added: 1, removed: 2, binary: 1 },
      { added: 1, removed: 2, binary: 1 },
      undefined,
    ];

    const pty = createPty(() => {
      const value = statsSequence[Math.min(calls, statsSequence.length - 1)];
      calls += 1;
      return value;
    });

    expect(() => {
      PtyCard({
        pty,
        isSelected: false,
        maxWidth: 80,
        index: 0,
        totalCount: 1,
        aggregateTheme: DEFAULT_THEME.ui.aggregate,
        textColors: {
          foreground: "#ffffff",
          muted: "#999999",
          subtle: "#777777",
        },
      });
    }).not.toThrow();
  });
});
