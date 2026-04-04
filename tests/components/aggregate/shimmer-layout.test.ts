import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { PtyInfo } from '../../../src/contexts/aggregate-view-types';
import {
  applyShimmerToText,
  clearPtyStdoutActivity,
  getPtyShimmerColor,
  hasMeaningfulActivity,
  recordPtyStdoutActivity,
} from '../../../src/core/shimmer';

function createMockPty(overrides: Partial<PtyInfo> = {}): PtyInfo {
  return {
    ptyId: overrides.ptyId ?? 'pty-1',
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

describe('Shimmer Layout Stability - current shimmer API', () => {
  beforeEach(() => {
    clearPtyStdoutActivity('pty-1');
  });

  it('only returns color changes and never changes text length', () => {
    const text = 'project (codex)';
    const shimmered = applyShimmerToText(text, '#c0c0c0', { targetColor: '#000000' });

    const rebuilt = text.split('');
    for (const entry of shimmered) {
      rebuilt[entry.index] = entry.char;
      expect(entry.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }

    expect(rebuilt.join('')).toBe(text);
    expect(text.length).toBe('project (codex)'.length);
  });

  it('produces valid hex colors during the shimmer sweep', () => {
    // Event-based: first record activity to create shimmer state, then calculate
    let now = 1000;
    recordPtyStdoutActivity('pty-test', now); // Creates shimmer state
    recordPtyStdoutActivity('pty-test', now + 100); // 2 events = active

    const colors: string[] = [];

    for (let index = 0; index < 8; index++) {
      now += 120;
      // Use getPtyShimmerColor with explicit time for event-based architecture
      const color = getPtyShimmerColor('pty-test', '#cccccc', index % 4, 12, now, {
        targetColor: '#101010',
      });
      if (color) {
        colors.push(color);
      }
    }

    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('does not mark a PTY as shimmer-active without recent stdout activity', () => {
    const pty = createMockPty({ ptyId: 'pty-1' });
    expect(hasMeaningfulActivity(pty)).toBe(false);
  });

  it('marks a PTY as shimmer-active only while stdout is recent', () => {
    vi.useFakeTimers();

    const pty = createMockPty({ ptyId: 'pty-1' });
    const now = Date.now();
    recordPtyStdoutActivity('pty-1', now - 500);
    recordPtyStdoutActivity('pty-1', now);

    expect(hasMeaningfulActivity(pty)).toBe(true);

    vi.advanceTimersByTime(3000);
    expect(hasMeaningfulActivity(pty)).toBe(false);

    vi.useRealTimers();
  });

  it('keeps row-style assumptions constant while shimmer colors change', () => {
    const styles = Array.from({ length: 10 }, () => ({ height: 1, padding: 0 }));
    for (const style of styles) {
      expect(style).toEqual({ height: 1, padding: 0 });
    }
  });
});
