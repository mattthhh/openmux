/**
 * Filter operations litmus tests - fast, single concept tests.
 */

import { describe, it, expect } from 'bun:test';
import {
  normalizeProcessName,
  isActivePty,
  filterActivePtys,
  getBasePtys,
  buildPtyIndex,
  groupPtysBySession,
  extractSessionIds,
} from '../filter';
import type { PtyInfo } from '../types';

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

describe('normalizeProcessName', () => {
  it('strips paths and lowercases', () => {
    expect(normalizeProcessName('/usr/bin/node')).toBe('node');
    expect(normalizeProcessName('NODE')).toBe('node');
    expect(normalizeProcessName('  vim  ')).toBe('vim');
  });

  it('handles empty/undefined', () => {
    expect(normalizeProcessName('')).toBe('');
    expect(normalizeProcessName(undefined)).toBe('');
  });
});

describe('isActivePty', () => {
  it('returns false for shell-only processes', () => {
    const pty = createMockPty({ foregroundProcess: '/bin/bash', shell: '/bin/bash' });
    expect(isActivePty(pty)).toBe(false);
  });

  it('returns true for non-shell processes', () => {
    const pty = createMockPty({ foregroundProcess: 'vim', shell: '/bin/bash' });
    expect(isActivePty(pty)).toBe(true);
  });

  it('returns false when no foreground process', () => {
    const pty = createMockPty({ foregroundProcess: undefined });
    expect(isActivePty(pty)).toBe(false);
  });
});

describe('filterActivePtys', () => {
  it('filters out shell-only PTYs', () => {
    const ptys = [
      createMockPty({ ptyId: '1', foregroundProcess: 'bash', shell: 'bash' }),
      createMockPty({ ptyId: '2', foregroundProcess: 'vim', shell: 'bash' }),
      createMockPty({ ptyId: '3', foregroundProcess: 'node', shell: 'zsh' }),
    ];
    const result = filterActivePtys(ptys);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.ptyId)).toEqual(['2', '3']);
  });
});

describe('getBasePtys', () => {
  it('returns all PTYs when showInactive is true', () => {
    const ptys = [
      createMockPty({ foregroundProcess: 'bash' }),
      createMockPty({ foregroundProcess: 'vim' }),
    ];
    expect(getBasePtys(ptys, true)).toHaveLength(2);
  });

  it('filters inactive when showInactive is false', () => {
    const ptys = [
      createMockPty({ ptyId: '1', foregroundProcess: 'bash', shell: 'bash' }),
      createMockPty({ ptyId: '2', foregroundProcess: 'vim', shell: 'bash' }),
    ];
    const result = getBasePtys(ptys, false);
    expect(result).toHaveLength(1);
    expect(result[0].ptyId).toBe('2');
  });
});

describe('buildPtyIndex', () => {
  it('creates correct index mapping', () => {
    const ptys = [
      createMockPty({ ptyId: 'a' }),
      createMockPty({ ptyId: 'b' }),
      createMockPty({ ptyId: 'c' }),
    ];
    const index = buildPtyIndex(ptys);
    expect(index.get('a')).toBe(0);
    expect(index.get('b')).toBe(1);
    expect(index.get('c')).toBe(2);
  });
});

describe('groupPtysBySession', () => {
  it('groups PTYs by sessionId', () => {
    const ptys = [
      createMockPty({ ptyId: '1', sessionId: 'session-a' }),
      createMockPty({ ptyId: '2', sessionId: 'session-b' }),
      createMockPty({ ptyId: '3', sessionId: 'session-a' }),
    ];
    const groups = groupPtysBySession(ptys);
    expect(groups.get('session-a')).toHaveLength(2);
    expect(groups.get('session-b')).toHaveLength(1);
  });
});

describe('extractSessionIds', () => {
  it('extracts unique session IDs', () => {
    const ptys = [
      createMockPty({ sessionId: 'a' }),
      createMockPty({ sessionId: 'b' }),
      createMockPty({ sessionId: 'a' }),
    ];
    const ids = extractSessionIds(ptys);
    expect(ids).toEqual(['a', 'b']);
  });
});
