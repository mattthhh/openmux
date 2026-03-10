/**
 * Aggregate bridge types
 * Core type definitions for PTY metadata and session tree views
 */

import type { PtyId, SessionId } from "../../types"
import type { SessionMetadata } from "../../models"
import type { GitDiffStats, GitInfo } from "../../services/pty/helpers"

/** PTY metadata for aggregate view */
export interface PtyMetadata {
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  gitDiffStats: GitDiffStats | undefined
  gitDirty: boolean
  gitStaged: number
  gitUnstaged: number
  gitUntracked: number
  gitConflicted: number
  gitAhead: number | undefined
  gitBehind: number | undefined
  gitStashCount: number | undefined
  gitState: GitInfo["state"] | undefined
  gitDetached: boolean
  gitRepoKey: string | undefined
  foregroundProcess: string | undefined
  shell: string | undefined
  title: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}

/** Options for fetching PTY metadata */
export interface FetchPtyMetadataOptions {
  skipGitDiffStats?: boolean
}

/** Represents a session with its associated PTYs for tree view */
export interface SessionWithPtys {
  /** Session metadata (always available) */
  session: SessionMetadata
  /** 
   * PTYs in this session:
   * - PtyMetadata[] if session is loaded
   * - 'unloaded' if session is not loaded (lazy-load on demand)
   */
  ptys: PtyMetadata[] | 'unloaded'
  /** Whether this session is currently active */
  isActive: boolean
  /** Number of PTYs in the session (cached for unloaded sessions) */
  ptyCount: number
}

/** Tree node type for visual rendering */
export type VisualTreeNode =
  | { type: 'session'; sessionId: string; isLast: boolean; isActive: boolean }
  | { type: 'pty'; ptyId: string; sessionId: string; isLast: boolean; ptyInfo: PtyMetadata }
  | { type: 'placeholder'; sessionId: string; isLast: boolean; count: number }

/** Options for listing sessions with PTYs */
export interface ListSessionsWithPtysOptions {
  /** Skip expensive git diff stats (useful for polling) */
  skipGitDiffStats?: boolean
  /** Maximum concurrent PTY metadata fetches */
  batchSize?: number
}

/** Options for listing all PTYs */
export interface ListAllPtysOptions {
  /** Skip fetching git diff stats (useful for polling to reduce overhead) */
  skipGitDiffStats?: boolean
}

/** Result of loading a session's PTYs */
export interface LoadSessionPtysResult {
  /** Session ID that was loaded */
  sessionId: string
  /** PTYs in the session */
  ptys: PtyMetadata[]
  /** Last active workspace ID from session data */
  lastActiveWorkspaceId: number | undefined
}

/** Cache entry for session-PTY mapping */
export interface SessionPtyCacheEntry {
  /** Session ID */
  sessionId: SessionId
  /** PTY IDs in this session */
  ptyIds: Set<PtyId>
  /** Last updated timestamp */
  lastUpdated: number
  /** Whether this session is currently loaded */
  isLoaded: boolean
}

/** Session PTY mapping structure (from shim-bridge) */
export interface SessionPtyMapping {
  /** Map of pane IDs to PTY IDs */
  mapping: Map<string, string>
  /** List of stale (no longer valid) pane IDs */
  stalePaneIds: string[]
}
