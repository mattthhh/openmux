import { beforeAll, describe, expect, test } from 'bun:test';

let resolvePaneCwd: typeof import('../../../src/components/app/pty-creation').resolvePaneCwd;

describe('usePtyCreation', () => {
  beforeAll(async () => {
    ({ resolvePaneCwd } = await import('../../../src/components/app/pty-creation'));
  });

  test('uses pending cwd promise for focused pane when session cwd is missing', async () => {
    let resolveCwd: (cwd: string | null) => void = () => {};
    const pendingPromise = new Promise<string | null>((resolve) => {
      resolveCwd = resolve;
    });

    const resultPromise = resolvePaneCwd({
      paneId: 'pane-1',
      focusedPaneId: 'pane-1',
      sessionCwd: undefined,
      pendingCwdRef: null,
      pendingCwdPromise: pendingPromise,
      fallbackCwd: '/startup',
    });

    resolveCwd('/tmp/project');
    const result = await resultPromise;

    expect(result).toEqual({ cwd: '/tmp/project', clearPending: true });
  });

  test('does not use pending cwd for non-focused panes', async () => {
    const result = await resolvePaneCwd({
      paneId: 'pane-2',
      focusedPaneId: 'pane-1',
      sessionCwd: undefined,
      pendingCwdRef: '/tmp/active',
      pendingCwdPromise: Promise.resolve('/tmp/active'),
      fallbackCwd: '/startup',
    });

    expect(result).toEqual({ cwd: '/startup', clearPending: false });
  });
});
