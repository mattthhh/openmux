/**
 * Aggregate view bridge functions (errore version)
 * Provides PTY listing with metadata for aggregate view
 * 
 * Directly uses PtyService interface without Effect runtime.
 * Backward-compatible versions use the global services singleton.
 */

import type { PtyService } from "../services/Pty"
import type { PtyId } from "../types"
import type { GitDiffStats, GitInfo } from "../services/pty/helpers"
import { getPtyService, hasServices } from "./services-instance"

interface PtyMetadata {
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

interface FetchPtyMetadataOptions {
  skipGitDiffStats?: boolean
}

/** Helper to convert string to PtyId branded type */
const asPtyId = (id: string): PtyId => id as PtyId

/**
 * Fetch metadata for a single PTY.
 * Returns null if PTY is invalid or defunct.
 */
async function fetchPtyMetadata(
  pty: PtyService,
  ptyId: PtyId,
  options: FetchPtyMetadataOptions = {}
): Promise<PtyMetadata | null> {
  try {
    // Get session - trust Pty service for validity
    const session = await pty.getSession(ptyId)
    if (session instanceof Error || session.pid === 0) {
      return null
    }

    // Fetch cwd, git info, foregroundProcess in parallel
    const [cwdResult, gitInfoResult, foregroundProcessResult] = await Promise.all([
      pty.getCwd(ptyId),
      pty.getGitInfo(ptyId).catch(() => undefined),
      pty.getForegroundProcess(ptyId).catch(() => undefined),
    ])

    const cwd = cwdResult instanceof Error ? process.cwd() : cwdResult
    const gitInfo = gitInfoResult instanceof Error ? undefined : gitInfoResult
    const foregroundProcess = foregroundProcessResult instanceof Error ? undefined : foregroundProcessResult

    // Skip defunct processes (zombie processes)
    if (foregroundProcess?.includes('defunct')) {
      return null
    }

    // Fetch git diff stats (only if we have a cwd and not skipped)
    const gitDiffStats = options.skipGitDiffStats
      ? undefined
      : await pty.getGitDiffStats(ptyId).catch(() => undefined)

    const gitInfoValue = gitInfo as GitInfo | undefined

    return {
      ptyId,
      cwd,
      gitBranch: gitInfoValue?.branch,
      gitDiffStats: gitDiffStats instanceof Error ? undefined : gitDiffStats,
      gitDirty: gitInfoValue?.dirty ?? false,
      gitStaged: gitInfoValue?.staged ?? 0,
      gitUnstaged: gitInfoValue?.unstaged ?? 0,
      gitUntracked: gitInfoValue?.untracked ?? 0,
      gitConflicted: gitInfoValue?.conflicted ?? 0,
      gitAhead: gitInfoValue?.ahead,
      gitBehind: gitInfoValue?.behind,
      gitStashCount: gitInfoValue?.stashCount,
      gitState: gitInfoValue?.state,
      gitDetached: gitInfoValue?.detached ?? false,
      gitRepoKey: gitInfoValue?.repoKey,
      foregroundProcess,
      shell: session.shell,
      title: undefined, // Title is set dynamically via title change events
      workspaceId: undefined, // Will be enriched by AggregateView
      paneId: undefined,      // Will be enriched by AggregateView
    }
  } catch {
    return null
  }
}

export interface ListAllPtysOptions {
  /** Skip fetching git diff stats (useful for polling to reduce overhead) */
  skipGitDiffStats?: boolean
}

/**
 * Fetch metadata for a single PTY by ID.
 * Useful for staggered polling to avoid subprocess burst.
 * 
 * Backward-compatible version that uses global services singleton.
 *
 * @param ptyId - The PTY ID to fetch metadata for
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns PTY metadata or null if PTY is invalid/defunct
 */
export async function getPtyMetadata(
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot fetch PTY metadata")
    return null
  }
  return getPtyMetadataWithService(getPtyService(), ptyId, options)
}

/**
 * List all PTYs with their metadata.
 * Fetches metadata in parallel for better performance.
 * 
 * Backward-compatible version that uses global services singleton.
 *
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtysWithMetadata(
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[]> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot list PTYs")
    return []
  }
  return listAllPtysWithMetadataWithService(getPtyService(), options)
}

/**
 * Fetch metadata for a single PTY by ID with explicit service.
 * Useful for staggered polling to avoid subprocess burst.
 *
 * @param pty - The PTY service
 * @param ptyId - The PTY ID to fetch metadata for
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns PTY metadata or null if PTY is invalid/defunct
 */
export async function getPtyMetadataWithService(
  pty: PtyService,
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null> {
  return fetchPtyMetadata(pty, asPtyId(ptyId), {
    skipGitDiffStats: options.skipGitDiffStats,
  })
}

/**
 * List all PTYs with their metadata with explicit service.
 * Fetches metadata in parallel for better performance.
 *
 * @param pty - The PTY service
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtysWithMetadataWithService(
  pty: PtyService,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[]> {
  try {
    const ptyIds = await pty.listAll()

    // Fetch all PTY metadata in parallel
    const results = await Promise.all(
      ptyIds.map((id) => fetchPtyMetadata(pty, id, { skipGitDiffStats: options.skipGitDiffStats }))
    )

    // Filter out null values
    return results.filter((meta): meta is PtyMetadata => meta !== null)
  } catch {
    return []
  }
}

export type { PtyMetadata }
