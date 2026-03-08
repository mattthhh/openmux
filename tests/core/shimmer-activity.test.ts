import { beforeEach, describe, expect, it } from 'bun:test';
import type { PtyInfo } from '../../src/contexts/aggregate-view-types';
import {
  clearPtyStdoutActivity,
  hasMeaningfulActivity,
  hasRecentPtyStdoutActivity,
  recordPtyStdoutActivity,
} from '../../src/core/shimmer';

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: overrides.ptyId ?? 'pty-test',
    cwd: '/tmp',
    gitBranch: undefined,
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
    foregroundProcess: 'codex',
    shell: '/bin/zsh',
    title: undefined,
    workspaceId: 1,
    paneId: 'pane-1',
    sessionId: 'session-1',
    sessionMetadata: undefined,
    ...overrides,
  };
}

describe('shimmer stdout activity heuristic', () => {
  const ptyId = 'pty-shimmer-test';

  beforeEach(() => {
    clearPtyStdoutActivity(ptyId);
  });

  it('requires sustained recent stdout activity before shimmering', () => {
    const now = Date.now();
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(false);

    recordPtyStdoutActivity(ptyId, now - 500);
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(false);

    recordPtyStdoutActivity(ptyId, now);
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(true);
  });

  it('expires shimmer activity after the stdout window elapses', () => {
    recordPtyStdoutActivity(ptyId, 1000);
    recordPtyStdoutActivity(ptyId, 1500);

    expect(hasRecentPtyStdoutActivity(ptyId, 3000)).toBe(true);
    expect(hasRecentPtyStdoutActivity(ptyId, 5001)).toBe(false);
  });

  it('does not shimmer background watcher processes even if they emit output', () => {
    const now = Date.now();
    recordPtyStdoutActivity(ptyId, now - 500);
    recordPtyStdoutActivity(ptyId, now);

    const pty = createMockPty({
      ptyId,
      foregroundProcess: 'webpack --watch',
    });

    expect(hasMeaningfulActivity(pty)).toBe(false);
  });

  it('shimmers active processes only while stdout is still flowing', () => {
    const pty = createMockPty({ ptyId });
    const now = Date.now();

    expect(hasMeaningfulActivity(pty)).toBe(false);

    recordPtyStdoutActivity(ptyId, now - 500);
    recordPtyStdoutActivity(ptyId, now);
    expect(hasMeaningfulActivity(pty)).toBe(true);

    clearPtyStdoutActivity(ptyId);
    expect(hasMeaningfulActivity(pty)).toBe(false);
  });
});
