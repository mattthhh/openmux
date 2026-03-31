/**
 * Integration tests for aggregate view operations.
 * Tests the interaction between filter, tree building, and sorting.
 */

import { describe, it, expect } from 'bun:test';
import { buildTreeRoot, flattenTree, getSortedSessions } from '../';
import { filterPtys, groupPtysBySession, sortPtysForSession } from '../filter';
import type { PtyInfo, SessionMetadata } from '../types';

const createMockPty = (overrides: Partial<PtyInfo> = {}): PtyInfo => ({
  ptyId: 'pty-1',
  cwd: '/home/user',
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
  foregroundProcess: 'bash',
  shell: '/bin/bash',
  title: undefined,
  workspaceId: 1,
  paneId: 'pane-1',
  sessionId: 'session-1',
  sessionMetadata: undefined,
  ...overrides,
});

const createMockSession = (overrides: Partial<SessionMetadata> = {}): SessionMetadata => ({
  id: 'session-1',
  name: 'Test Session',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('aggregate view integration', () => {
  it('filters PTYs then builds tree', () => {
    const ptys = [
      createMockPty({ ptyId: '1', cwd: '/home/user/project', sessionId: 'session-a' }),
      createMockPty({ ptyId: '2', cwd: '/home/user/docs', sessionId: 'session-a' }),
      createMockPty({ ptyId: '3', cwd: '/var/log', sessionId: 'session-b' }),
    ];

    const filtered = filterPtys(ptys, 'project');
    expect(filtered instanceof Error).toBe(false);
    if (filtered instanceof Error) return;

    expect(filtered).toHaveLength(1);
    expect(filtered[0].ptyId).toBe('1');

    const grouped = groupPtysBySession(filtered);
    const sessions = [createMockSession({ id: 'session-a', name: 'Session A' })];

    const tree = buildTreeRoot(sessions, grouped, new Set(['session-a']), new Map(), new Map());

    expect(tree.length).toBeGreaterThan(0);
    const sessionNode = tree.find((n) => n.type === 'session');
    expect(sessionNode).toBeDefined();
  });

  it('builds tree then flattens', () => {
    const ptys = [
      createMockPty({ ptyId: '1', sessionId: 'session-a', paneId: 'pane-1' }),
      createMockPty({ ptyId: '2', sessionId: 'session-a', paneId: 'pane-2' }),
    ];

    const grouped = groupPtysBySession(ptys);
    const sessions = [createMockSession({ id: 'session-a', name: 'Session A' })];

    const tree = buildTreeRoot(
      sessions,
      grouped,
      new Set(['session-a']),
      new Map([['session-a', { status: 'loaded' }]]),
      new Map()
    );

    expect(tree.length).toBe(3);

    const flattened = flattenTree(tree, '', true);
    expect(flattened.length).toBeGreaterThan(0);

    const ptyItems = flattened.filter((i) => i.node.type === 'pty');
    expect(ptyItems).toHaveLength(2);
  });

  it('sorts PTYs before building tree', () => {
    const ptys = [
      createMockPty({ ptyId: 'c', paneId: 'pane-3', workspaceId: 1 }),
      createMockPty({ ptyId: 'a', paneId: 'pane-1', workspaceId: 1 }),
      createMockPty({ ptyId: 'b', paneId: 'pane-2', workspaceId: 1 }),
    ];

    const paneOrder = new Map([
      ['pane-1', 0],
      ['pane-2', 1],
      ['pane-3', 2],
    ]);
    const sorted = sortPtysForSession(ptys, paneOrder);

    expect(sorted[0].ptyId).toBe('a');
    expect(sorted[1].ptyId).toBe('b');
    expect(sorted[2].ptyId).toBe('c');
  });

  it('sorts sessions with manual order', () => {
    const sessions = new Map([
      ['a', createMockSession({ id: 'a', name: 'Alpha' })],
      ['b', createMockSession({ id: 'b', name: 'Beta' })],
      ['c', createMockSession({ id: 'c', name: 'Charlie' })],
    ]);

    const manualOrder = ['c', 'a', 'b'];
    const sorted = getSortedSessions(sessions, manualOrder);

    expect(sorted[0].id).toBe('c');
    expect(sorted[1].id).toBe('a');
    expect(sorted[2].id).toBe('b');
  });

  it('falls back to name sort for unordered sessions', () => {
    const sessions = new Map([
      ['z', createMockSession({ id: 'z', name: 'Zebra' })],
      ['a', createMockSession({ id: 'a', name: 'Alpha' })],
    ]);

    const sorted = getSortedSessions(sessions, []);
    expect(sorted[0].id).toBe('a');
    expect(sorted[1].id).toBe('z');
  });
});
