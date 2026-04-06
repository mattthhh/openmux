import { describe, expect, it } from 'bun:test';

import type { SessionMetadata } from '../../../../src/effect/models';
import {
  collectCwdMap,
  serializeSession,
} from '../../../../src/effect/services/session-manager/serialization';
import type { WorkspaceState } from '../../../../src/effect/services/session-manager/types';
import type { WorkspaceId, SessionId } from '../../../../src/effect/types';

const createWorkspaceWithPane = (paneId: string, ptyId: string): WorkspaceState => ({
  mainPane: { id: paneId, ptyId },
  stackPanes: [],
  focusedPaneId: paneId,
  layoutMode: 'vertical',
  activeStackIndex: 0,
  zoomed: false,
});

const createWorkspaceWithSplit = (
  first: { paneId: string; ptyId: string },
  second: { paneId: string; ptyId: string }
): WorkspaceState => ({
  mainPane: {
    type: 'split',
    id: 'split-1',
    direction: 'horizontal',
    ratio: 0.5,
    first: { id: first.paneId, ptyId: first.ptyId },
    second: { id: second.paneId, ptyId: second.ptyId },
  },
  stackPanes: [],
  focusedPaneId: first.paneId,
  layoutMode: 'vertical',
  activeStackIndex: 0,
  zoomed: false,
});

const createEmptyWorkspace = (): WorkspaceState => ({
  mainPane: null,
  stackPanes: [],
  focusedPaneId: undefined,
  layoutMode: 'vertical',
  activeStackIndex: 0,
  zoomed: false,
});

const createMetadata = (): SessionMetadata => ({
  id: 'session-1' as SessionId,
  name: 'Test Session',
  createdAt: 1,
  lastSwitchedAt: 2,
  autoNamed: false,
});

describe('collectCwdMap', () => {
  it('fetches PTY cwd values in parallel during snapshot save', async () => {
    const workspaces = new Map<number, WorkspaceState>([
      [
        1,
        createWorkspaceWithSplit(
          { paneId: 'pane-1', ptyId: 'pty-1' },
          { paneId: 'pane-2', ptyId: 'pty-2' }
        ),
      ],
    ]);

    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const collectPromise = collectCwdMap(workspaces, async (ptyId) => {
      started.push(ptyId);
      await gate;
      return `/cwd/${ptyId}`;
    });

    await Promise.resolve();

    expect(started).toEqual(['pty-1', 'pty-2']);

    release();
    const cwdMap = await collectPromise;

    expect(cwdMap.get('pty-1')).toBe('/cwd/pty-1');
    expect(cwdMap.get('pty-2')).toBe('/cwd/pty-2');
  });
});

describe('serializeSession', () => {
  it('falls back to the first populated workspace when the active workspace is empty', () => {
    const metadata = createMetadata();
    const workspaces = new Map<number, WorkspaceState>([
      [1, createEmptyWorkspace()],
      [2, createWorkspaceWithPane('pane-1', 'pty-1')],
    ]);
    const cwdMap = new Map<string, string>([['pty-1', '/tmp']]);

    const session = serializeSession(metadata, workspaces, 1 as WorkspaceId, cwdMap);

    expect(session.activeWorkspaceId).toBe(2 as WorkspaceId);
  });

  it('keeps the active workspace when it has panes', () => {
    const metadata = createMetadata();
    const workspaces = new Map<number, WorkspaceState>([
      [2, createWorkspaceWithPane('pane-2', 'pty-2')],
    ]);
    const cwdMap = new Map<string, string>([['pty-2', '/tmp']]);

    const session = serializeSession(metadata, workspaces, 2 as WorkspaceId, cwdMap);

    expect(session.activeWorkspaceId).toBe(2 as WorkspaceId);
  });

  it('keeps the active workspace when no workspaces are serialized', () => {
    const metadata = createMetadata();
    const workspaces = new Map<number, WorkspaceState>();

    const session = serializeSession(metadata, workspaces, 3 as WorkspaceId, new Map());

    expect(session.activeWorkspaceId).toBe(3 as WorkspaceId);
  });
});
