import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { createRoot, createSignal } from 'solid-js';

import { clearPtyStdoutActivity, hasRecentPtyStdoutActivity } from '../../../src/core/shimmer';
import { effectBridgeMocks } from '../../mocks/effect-bridge';

mock.module('../../../src/effect/bridge', () => effectBridgeMocks);
import type { PtyInfo } from '../../../src/contexts/aggregate-view-types';

const createPty = (ptyId: string): PtyInfo => ({
  ptyId,
  sessionId: 'session-1',
  cwd: '/tmp',
  workspaceId: 1,
  paneId: 'pane-1',
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
  gitIsWorktree: false,
  gitCommonDir: null,
  foregroundProcess: 'htop',
  shell: 'zsh',
  title: 'htop',
  sessionMetadata: undefined,
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('useActivitySubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPtyStdoutActivity('pty-1');
    clearPtyStdoutActivity('pty-2');
    clearPtyStdoutActivity('saved:session-2:pane-9');
  });

  it('records tracked PTY activity from a single global activity subscription', async () => {
    const { useActivitySubscriptions } =
      await import('../../../src/components/aggregate/hooks/useActivitySubscriptions');
    let capturedActivity: ((event: { ptyId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    effectBridgeMocks.subscribeToAllPtyActivity.mockImplementation(
      async (callback: (event: { ptyId: string }) => void) => {
        capturedActivity = callback;
        return unsubscribe;
      }
    );

    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      useActivitySubscriptions({
        isActive: () => true,
        getTrackedPtys: () => [createPty('pty-1')],
      });
    });

    await flush();

    expect(effectBridgeMocks.subscribeToAllPtyActivity).toHaveBeenCalledWith(expect.any(Function));

    capturedActivity?.({ ptyId: 'pty-1' });
    capturedActivity?.({ ptyId: 'pty-2' });
    capturedActivity?.({ ptyId: 'pty-1' });

    expect(hasRecentPtyStdoutActivity('pty-1')).toBe(true);

    dispose();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('cleans up late subscriptions if the hook deactivates before subscribe resolves', async () => {
    const { useActivitySubscriptions } =
      await import('../../../src/components/aggregate/hooks/useActivitySubscriptions');
    let resolveSubscribe!: (value: () => void) => void;
    const unsubscribe = vi.fn();
    effectBridgeMocks.subscribeToAllPtyActivity.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveSubscribe = resolve;
        })
    );

    const [isActive, setIsActive] = createSignal(true);
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      useActivitySubscriptions({
        isActive,
        getTrackedPtys: () => [createPty('pty-1')],
      });
    });

    await flush();
    setIsActive(false);
    await flush();

    resolveSubscribe(unsubscribe);
    await flush();

    expect(unsubscribe).toHaveBeenCalled();

    dispose();
  });

  it('keeps the pending global subscription when tracked PTYs change', async () => {
    const { useActivitySubscriptions } =
      await import('../../../src/components/aggregate/hooks/useActivitySubscriptions');
    let resolveSubscribe!: (value: () => void) => void;
    let capturedActivity: ((event: { ptyId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    effectBridgeMocks.subscribeToAllPtyActivity.mockImplementation(
      (callback: (event: { ptyId: string }) => void) =>
        new Promise<() => void>((resolve) => {
          capturedActivity = callback;
          resolveSubscribe = resolve;
        })
    );

    const [trackedPtys, setTrackedPtys] = createSignal([createPty('pty-1')]);
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      useActivitySubscriptions({
        isActive: () => true,
        getTrackedPtys: trackedPtys,
      });
    });

    await flush();
    expect(effectBridgeMocks.subscribeToAllPtyActivity).toHaveBeenCalledTimes(1);

    setTrackedPtys([createPty('pty-1'), createPty('pty-2')]);
    await flush();
    expect(effectBridgeMocks.subscribeToAllPtyActivity).toHaveBeenCalledTimes(1);

    resolveSubscribe(unsubscribe);
    await flush();

    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('mirrors background PTY activity onto tracked saved rows by session and pane', async () => {
    const { useActivitySubscriptions } =
      await import('../../../src/components/aggregate/hooks/useActivitySubscriptions');
    let capturedActivity: ((event: { ptyId: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    effectBridgeMocks.subscribeToAllPtyActivity.mockImplementation(
      async (callback: (event: { ptyId: string }) => void) => {
        capturedActivity = callback;
        return unsubscribe;
      }
    );

    const savedRow = createPty('saved:session-2:pane-9');
    savedRow.sessionId = 'session-2';
    savedRow.paneId = 'pane-9';

    let dispose!: () => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      useActivitySubscriptions({
        isActive: () => true,
        getTrackedPtys: () => [savedRow],
        resolvePtyOwnership: (ptyId) =>
          ptyId === 'pty-background' ? { sessionId: 'session-2', paneId: 'pane-9' } : null,
      });
    });

    await flush();

    capturedActivity?.({ ptyId: 'pty-background' });
    capturedActivity?.({ ptyId: 'pty-background' });

    expect(hasRecentPtyStdoutActivity('saved:session-2:pane-9')).toBe(true);
    expect(hasRecentPtyStdoutActivity('pty-background')).toBe(true);

    dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
