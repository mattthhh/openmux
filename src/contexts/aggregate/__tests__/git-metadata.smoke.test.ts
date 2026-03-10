/**
 * Smoke tests for git metadata - basic integration checks.
 */

import { describe, it, expect } from 'vitest';
import { extractGitMetadata, areGitDiffStatsEqual, didPtyInfoChange } from '../git/metadata';
import type { GitRepoMetadata } from '../../git-metadata-cache';
import type { PtyInfo } from '../../aggregate-view-types';

describe('git metadata (smoke)', () => {
  describe('integration flow', () => {
    it('can detect changes between old and new metadata', () => {
      const oldMetadata: GitRepoMetadata = {
        branch: 'main',
        dirty: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'clean',
        detached: false,
        repoKey: '/repo',
        diffStats: undefined,
      };
      
      const newMetadata: GitRepoMetadata = {
        ...oldMetadata,
        dirty: true,
        staged: 1,
        diffStats: { added: 5, removed: 0, binary: 0 },
      };
      
      const oldFields = extractGitMetadata(oldMetadata);
      const newFields = extractGitMetadata(newMetadata);
      
      expect(oldFields.gitDirty).toBe(false);
      expect(newFields.gitDirty).toBe(true);
      expect(oldFields.gitStaged).toBe(0);
      expect(newFields.gitStaged).toBe(1);
    });

    it('can compare PTY info with extracted metadata', () => {
      const metadata: GitRepoMetadata = {
        branch: 'main',
        dirty: false,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        ahead: undefined,
        behind: undefined,
        stashCount: undefined,
        state: 'clean',
        detached: false,
        repoKey: '/repo',
        diffStats: undefined,
      };
      
      const gitFields = extractGitMetadata(metadata);
      const pty: PtyInfo = {
        ptyId: 'pty-1',
        cwd: '/repo',
        foregroundProcess: 'bash',
        shell: '/bin/bash',
        title: 'bash',
        workspaceId: 1,
        paneId: 'pane-1',
        sessionId: 'session-1',
        sessionMetadata: undefined,
        ...gitFields,
      };
      
      // Simulated updated metadata
      const updatedMetadata = { ...metadata, dirty: true, unstaged: 3 };
      const updatedFields = extractGitMetadata(updatedMetadata);
      const updatedPty: PtyInfo = { ...pty, ...updatedFields };
      
      expect(didPtyInfoChange(pty, updatedPty)).toBe(true);
    });
  });
});
