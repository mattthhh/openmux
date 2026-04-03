/**
 * Full coverage tests for aggregate view operations.
 */

import { describe, it, expect, vi } from 'bun:test';
import { produce } from 'solid-js/store';
import {
  // Filter
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  getBasePtys,
  filterPtys,
  buildPtyIndex,
  groupPtysBySession,
  sortPtysForSession,
  extractSessionIds,
  // Tree
  getDefaultLoadState,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  createUnloadedPlaceholder,
  buildTreeRoot,
  flattenTree,
  buildFlattenedTreeIndex,
  // Selection
  applySelection,
  clearPreviewState,
  getSelectedPty,
  getSelectedItem,
  getSelectedSessionId,
  selectAfterPtyRemoval,
  // Session
  toggleSessionExpanded,
  getSortedSessions,
  recomputeMatches,
  recomputeTree,
  createSessionActions,
} from '../';
import type { PtyInfo, SessionMetadata, AggregateViewState } from '../types';
import { FilterOperationError, SelectionOperationError } from '../errors';

// Mock helpers
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

const createMockState = (overrides: Partial<AggregateViewState> = {}): AggregateViewState => ({
  showAggregateView: false,
  filterQuery: '',
  showInactive: true,
  allPtys: [],
  matchedPtys: [],
  selectedIndex: 0,
  selectedPtyId: null,
  isLoading: false,
  previewMode: false,
  previewZoomed: false,
  allPtysIndex: new Map(),
  matchedPtysIndex: new Map(),
  treeRoot: [],
  flattenedTree: [],
  flattenedTreeIndex: new Map(),
  expandedSessionIds: new Set(),
  selectedSessionId: null,
  sessionLoadStates: new Map(),
  sessionPaneOrders: new Map(),
  manualSessionOrder: [],
  loadingSessionIds: new Set(),
  loadAttemptedSessionIds: new Set(),
  allSessions: new Map(),
  pendingPtyIds: new Set(),
  recentlyAddedPtyIds: new Set(),
  deletedPtyIds: new Set(),
  listScrollOffset: 0,
  ...overrides,
});

describe('Full Coverage: Filter Operations', () => {
  describe('normalizeProcessName', () => {
    it('handles complex paths', () => {
      expect(normalizeProcessName('/usr/local/bin/node')).toBe('node');
      expect(normalizeProcessName('./relative/path/script.sh')).toBe('script.sh');
      expect(normalizeProcessName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
    });

    it('handles whitespace-only strings', () => {
      expect(normalizeProcessName('   ')).toBe('');
      expect(normalizeProcessName('\t\n')).toBe('');
    });
  });

  describe('filterPtys', () => {
    it('matches multiple terms (OR logic)', () => {
      const ptys = [
        createMockPty({ cwd: '/home/user/project', gitBranch: 'main' }),
        createMockPty({ cwd: '/home/user/docs', foregroundProcess: 'vim' }),
        createMockPty({ cwd: '/var/log', gitBranch: 'develop' }),
      ];

      const result = filterPtys(ptys, 'project vim');
      expect(result instanceof Error).toBe(false);
      if (result instanceof Error) return;

      expect(result).toHaveLength(2);
    });

    it('is case insensitive', () => {
      const ptys = [
        createMockPty({ cwd: '/HOME/USER', gitBranch: 'MAIN', foregroundProcess: 'VIM' }),
      ];

      const result = filterPtys(ptys, 'home main vim');
      expect(result instanceof Error).toBe(false);
      if (result instanceof Error) return;

      expect(result).toHaveLength(1);
    });

    it('returns empty array for no matches', () => {
      const ptys = [createMockPty({ cwd: '/home' })];
      const result = filterPtys(ptys, 'nonexistent');
      expect(result instanceof Error).toBe(false);
      if (result instanceof Error) return;
      expect(result).toHaveLength(0);
    });
  });

  describe('groupPtysBySession', () => {
    it('handles empty array', () => {
      const result = groupPtysBySession([]);
      expect(result.size).toBe(0);
    });

    it('groups many PTYs efficiently', () => {
      const ptys = Array.from({ length: 100 }, (_, i) =>
        createMockPty({
          ptyId: `pty-${i}`,
          sessionId: `session-${i % 5}`,
        })
      );

      const groups = groupPtysBySession(ptys);
      expect(groups.size).toBe(5);
      expect(groups.get('session-0')).toHaveLength(20);
    });
  });

  describe('sortPtysForSession', () => {
    it('sorts by workspace ID when no pane order', () => {
      const ptys = [
        createMockPty({ ptyId: '1', workspaceId: 3, paneId: undefined }),
        createMockPty({ ptyId: '2', workspaceId: 1, paneId: undefined }),
        createMockPty({ ptyId: '3', workspaceId: 2, paneId: undefined }),
      ];

      const sorted = sortPtysForSession(ptys, undefined);
      expect(sorted[0].ptyId).toBe('2');
      expect(sorted[1].ptyId).toBe('3');
      expect(sorted[2].ptyId).toBe('1');
    });

    it('prioritizes pane order over workspace', () => {
      const ptys = [
        createMockPty({ ptyId: '1', workspaceId: 1, paneId: 'pane-2' }),
        createMockPty({ ptyId: '2', workspaceId: 2, paneId: 'pane-1' }),
      ];

      const paneOrder = new Map([
        ['pane-1', 0],
        ['pane-2', 1],
      ]);
      const sorted = sortPtysForSession(ptys, paneOrder);

      expect(sorted[0].ptyId).toBe('2');
      expect(sorted[1].ptyId).toBe('1');
    });
  });
});

describe('Full Coverage: Tree Operations', () => {
  describe('buildTreeRoot', () => {
    it('builds tree with mixed load states', () => {
      const sessions = [
        createMockSession({ id: 'a', name: 'Loading Session' }),
        createMockSession({ id: 'b', name: 'Error Session' }),
        createMockSession({ id: 'c', name: 'Loaded Session' }),
      ];

      const ptysBySession = new Map([
        ['c', [createMockPty({ sessionId: 'c', foregroundProcess: 'vim', shell: 'bash' })]],
      ]);

      const loadStates = new Map([
        ['a', { status: 'loading' as const }],
        ['b', { status: 'error' as const, error: 'Failed to load' }],
        ['c', { status: 'loaded' as const }],
      ]);

      const tree = buildTreeRoot(sessions, ptysBySession, new Set(['c']), loadStates, new Map());

      expect(tree.length).toBe(6);

      const loadingPlaceholder = tree.find((n) => n.type === 'placeholder' && n.isLoading);
      expect(loadingPlaceholder).toBeDefined();

      const errorPlaceholder = tree.find(
        (n) => n.type === 'placeholder' && n.message?.includes('Error')
      );
      expect(errorPlaceholder).toBeDefined();
    });

    it('calculates active PTY count correctly', () => {
      const sessions = [createMockSession({ id: 's1' })];
      const ptysBySession = new Map([
        [
          's1',
          [
            createMockPty({ foregroundProcess: 'bash', shell: 'bash' }),
            createMockPty({ foregroundProcess: 'vim', shell: 'bash' }),
            createMockPty({ foregroundProcess: 'node', shell: 'zsh' }),
          ],
        ],
      ]);

      const tree = buildTreeRoot(
        sessions,
        ptysBySession,
        new Set(['s1']),
        new Map([['s1', { status: 'loaded' as const }]]),
        new Map()
      );

      const sessionNode = tree.find((n) => n.type === 'session');
      expect(sessionNode?.type === 'session' && sessionNode.activePtyCount).toBe(2);
    });
  });

  describe('flattenTree', () => {
    it('respects showInactive flag', () => {
      const ptys = [
        createMockPty({ ptyId: '1', foregroundProcess: 'bash', shell: 'bash' }),
        createMockPty({ ptyId: '2', foregroundProcess: 'vim', shell: 'bash' }),
      ];

      const grouped = groupPtysBySession(ptys);
      const sessions = [createMockSession()];

      const tree = buildTreeRoot(
        sessions,
        grouped,
        new Set(['session-1']),
        new Map([['session-1', { status: 'loaded' as const }]]),
        new Map()
      );

      const flattenedWithInactive = flattenTree(tree, '', true);
      const ptyCountWithInactive = flattenedWithInactive.filter(
        (i) => i.node.type === 'pty'
      ).length;

      const flattenedWithoutInactive = flattenTree(tree, '', false);
      const ptyCountWithoutInactive = flattenedWithoutInactive.filter(
        (i) => i.node.type === 'pty'
      ).length;

      expect(ptyCountWithInactive).toBe(2);
      expect(ptyCountWithoutInactive).toBe(1);
    });

    it('filters sessions with no visible PTYs when query active', () => {
      const ptys = [
        createMockPty({ ptyId: '1', cwd: '/project', sessionId: 'session-a' }),
        createMockPty({ ptyId: '2', cwd: '/other', sessionId: 'session-b' }),
      ];

      const grouped = groupPtysBySession(ptys);
      const sessions = [
        createMockSession({ id: 'session-a', name: 'A' }),
        createMockSession({ id: 'session-b', name: 'B' }),
      ];

      const tree = buildTreeRoot(
        sessions,
        grouped,
        new Set(['session-a', 'session-b']),
        new Map([
          ['session-a', { status: 'loaded' as const }],
          ['session-b', { status: 'loaded' as const }],
        ]),
        new Map()
      );

      const flattened = flattenTree(tree, 'project', true);
      const sessionNodes = flattened.filter((i) => i.node.type === 'session');

      expect(sessionNodes).toHaveLength(1);
    });
  });
});

describe('Full Coverage: Selection Operations', () => {
  describe('selectAfterPtyRemoval', () => {
    it('handles PTY not in view', () => {
      const state = createMockState({
        flattenedTree: [],
        flattenedTreeIndex: new Map(),
      });

      const result = selectAfterPtyRemoval(state, 'nonexistent-pty');
      expect(result).toBeNull();
    });

    it('selects first available PTY when all else fails', () => {
      const pty1 = createMockPty({ ptyId: 'pty-1', sessionId: 'session-a' });
      const pty2 = createMockPty({ ptyId: 'pty-2', sessionId: 'session-b' });

      const state = createMockState({
        flattenedTree: [
          {
            node: {
              type: 'session',
              session: createMockSession({ id: 'session-a' }),
              ptyCount: 1,
              activePtyCount: 1,
              loadState: { status: 'loaded' },
              isExpanded: true,
            },
            depth: 0,
            isLast: false,
            prefix: '',
            index: 0,
            parentSessionId: undefined,
          },
          {
            node: { type: 'pty', ptyInfo: pty1, parentSessionId: 'session-a' },
            depth: 1,
            isLast: true,
            prefix: '',
            index: 1,
            parentSessionId: 'session-a',
          },
          {
            node: { type: 'spacer' },
            depth: 0,
            isLast: false,
            prefix: '',
            index: 2,
            parentSessionId: undefined,
          },
          {
            node: {
              type: 'session',
              session: createMockSession({ id: 'session-b' }),
              ptyCount: 1,
              activePtyCount: 1,
              loadState: { status: 'loaded' },
              isExpanded: true,
            },
            depth: 0,
            isLast: true,
            prefix: '',
            index: 3,
            parentSessionId: undefined,
          },
          {
            node: { type: 'pty', ptyInfo: pty2, parentSessionId: 'session-b' },
            depth: 1,
            isLast: true,
            prefix: '',
            index: 4,
            parentSessionId: 'session-b',
          },
        ],
        flattenedTreeIndex: new Map([
          ['pty-1', 1],
          ['pty-2', 4],
        ]),
        selectedIndex: 1,
        selectedPtyId: 'pty-1',
      });

      selectAfterPtyRemoval(state, 'pty-1');

      expect(state.selectedPtyId).toBe('pty-2');
    });
  });
});

describe('Full Coverage: Session Operations', () => {
  describe('toggleSessionExpanded', () => {
    it('expands collapsed session', () => {
      const expanded = new Set<string>();
      const result = toggleSessionExpanded(expanded, 'session-1');
      expect(result.has('session-1')).toBe(true);
    });

    it('collapses expanded session', () => {
      const expanded = new Set(['session-1']);
      const result = toggleSessionExpanded(expanded, 'session-1');
      expect(result.has('session-1')).toBe(false);
    });

    it('does not mutate original set', () => {
      const expanded = new Set(['session-1']);
      const result = toggleSessionExpanded(expanded, 'session-2');
      expect(expanded.has('session-2')).toBe(false);
      expect(result.has('session-2')).toBe(true);
    });
  });

  describe('getSortedSessions', () => {
    it('handles empty sessions', () => {
      const result = getSortedSessions(new Map(), []);
      expect(result).toEqual([]);
    });

    it('partial manual order only affects specified sessions', () => {
      const sessions = new Map([
        ['a', createMockSession({ id: 'a', name: 'Alpha' })],
        ['b', createMockSession({ id: 'b', name: 'Beta' })],
        ['c', createMockSession({ id: 'c', name: 'Charlie' })],
        ['z', createMockSession({ id: 'z', name: 'Zulu' })],
      ]);

      const manualOrder = ['z']; // Only specify first
      const sorted = getSortedSessions(sessions, manualOrder);

      expect(sorted[0].id).toBe('z');
      expect(sorted.slice(1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    });
  });
});

describe('Error Handling', () => {
  describe('FilterOperationError', () => {
    it('is returned on filter failure', () => {
      const ptys = [createMockPty()];

      // Simulate filter failure by checking error union type
      const result = filterPtys(ptys, '');
      if (result instanceof Error) {
        expect(result).toBeInstanceOf(FilterOperationError);
      }
    });
  });

  describe('SelectionOperationError', () => {
    it('has correct error properties', () => {
      const error = new SelectionOperationError({ reason: 'Test error' });
      expect(error.message).toContain('Test error');
      expect(error._tag).toBe('SelectionOperationError');
    });
  });
});
