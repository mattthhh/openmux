import { describe, expect, it } from 'bun:test';

import { createRequestHandler } from './server-requests';
import { createShimServerState } from './server-state';
import type { ShimHandlerContext } from './handlers';

function createContext(overrides?: { pty?: Record<string, (...args: any[]) => any> }) {
  const state = createShimServerState();
  const socket = { id: 1 } as any;
  state.activeClient = socket;
  state.activeClientId = 'client-1';

  const responses: Array<{ requestId: number; result: unknown }> = [];
  const errors: Array<{ requestId: number; error: string }> = [];

  const pty = {
    getSession: () => ({
      id: 'pty-1',
      pid: 42,
      cols: 80,
      rows: 24,
      cwd: '/session-cwd',
      shell: '/bin/zsh',
      title: 'editor',
      lastCommand: 'git status',
    }),
    getCwd: () => '/live-cwd',
    getForegroundProcess: () => 'vim',
    getGitInfo: (_ptyId: string, options?: { includeDiffStats?: boolean }) => ({
      branch: 'main',
      repoKey: '/repo',
      dirty: true,
      staged: 1,
      unstaged: 2,
      untracked: 0,
      conflicted: 0,
      ahead: undefined,
      behind: undefined,
      stashCount: undefined,
      state: undefined,
      detached: false,
      ...(options?.includeDiffStats ? { diffStats: { added: 2, removed: 1, binary: 0 } } : {}),
    }),
    ...overrides?.pty,
  };

  const context: ShimHandlerContext = {
    state,
    withPty: async (fn) => fn(pty),
    sendEvent: () => {},
    sendResponse: (_socket, requestId, result) => {
      responses.push({ requestId, result });
    },
    sendError: (_socket, requestId, error) => {
      errors.push({ requestId, error });
    },
    kittyHandlers: {
      sendKittyTransmit: () => {},
      sendKittyUpdate: () => {},
      queueKittyUpdate: () => {},
      hasCachedTransmit: () => false,
    },
    applyHostColors: () => {},
  };

  return {
    socket,
    responses,
    errors,
    handleRequest: createRequestHandler(context),
  };
}

describe('shim/server-requests', () => {
  it('returns consolidated PTY metadata', async () => {
    const fixture = createContext();

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 1,
        method: 'getPtyMetadata',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(fixture.errors).toEqual([]);
    expect(fixture.responses[0]?.result).toEqual({
      metadata: {
        session: {
          id: 'pty-1',
          pid: 42,
          cols: 80,
          rows: 24,
          cwd: '/session-cwd',
          shell: '/bin/zsh',
        },
        cwd: '/live-cwd',
        foregroundProcess: 'vim',
        gitInfo: {
          branch: 'main',
          repoKey: '/repo',
          dirty: true,
          staged: 1,
          unstaged: 2,
          untracked: 0,
          conflicted: 0,
          ahead: undefined,
          behind: undefined,
          stashCount: undefined,
          state: undefined,
          detached: false,
        },
        gitDiffStats: { added: 2, removed: 1, binary: 0 },
        title: 'editor',
        lastCommand: 'git status',
      },
    });
  });

  it('uses the consolidated current PtyService metadata surface', async () => {
    const calls: Array<{ includeDiffStats?: boolean }> = [];
    const fixture = createContext({
      pty: {
        getGitInfo: (_ptyId: string, options?: { includeDiffStats?: boolean }) => {
          calls.push({ includeDiffStats: options?.includeDiffStats });
          return {
            branch: 'main',
            repoKey: '/repo',
            dirty: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
            ahead: undefined,
            behind: undefined,
            stashCount: undefined,
            state: undefined,
            detached: false,
            diffStats: { added: 2, removed: 1, binary: 0 },
          };
        },
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 2,
        method: 'getPtyMetadata',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(calls).toEqual([{ includeDiffStats: true }]);
  });

  it('keeps legacy getters working via metadata fallbacks', async () => {
    const fixture = createContext({
      pty: {
        getCwd: () => new Error('cwd unavailable'),
        getGitInfo: () => ({
          branch: 'feature/refactor',
          repoKey: '/repo',
          dirty: false,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          ahead: undefined,
          behind: undefined,
          stashCount: undefined,
          state: undefined,
          detached: false,
        }),
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 1,
        method: 'getCwd',
        params: { ptyId: 'pty-1' },
      },
      []
    );
    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 2,
        method: 'getGitBranch',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(fixture.errors).toEqual([]);
    expect(fixture.responses[0]?.result).toEqual({ cwd: '/session-cwd' });
    expect(fixture.responses[1]?.result).toEqual({ branch: 'feature/refactor' });
  });
});
