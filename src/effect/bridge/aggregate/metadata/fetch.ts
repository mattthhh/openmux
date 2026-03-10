/**
 * PTY Metadata Fetching
 * Functions for fetching PTY metadata with batching and error handling
 */

import type { PtyService } from "../../../services/Pty"
import type { PtyId } from "../../../types"
import type { GitInfo } from "../../../services/pty/helpers"
import type { PtyMetadata, FetchPtyMetadataOptions } from "../types"
import { PtyMetadataError } from "../../../errors"
import { asPtyId } from "../cache/session-pty-cache"

/**
 * Fetch metadata for a single PTY.
 * Returns null if PTY is invalid or defunct.
 */
export async function fetchPtyMetadata(
  pty: PtyService,
  ptyId: PtyId,
  options: FetchPtyMetadataOptions = {}
): Promise<PtyMetadata | null> {
  const { skipGitDiffStats } = options

  // Get session - trust Pty service for validity
  const session = await pty.getSession(ptyId)
  if (session instanceof Error || session.pid === 0) {
    return null
  }

  // Fetch cwd, git info, foregroundProcess in parallel
  const [cwdResult, gitInfoResult, foregroundProcessResult] = await Promise.all([
    pty.getCwd(ptyId),
    pty.getGitInfo(ptyId).catch((e) => {
      console.warn(`Failed to get git info for PTY ${ptyId}:`, e)
      return undefined
    }),
    pty.getForegroundProcess(ptyId).catch((e) => {
      console.warn(`Failed to get foreground process for PTY ${ptyId}:`, e)
      return undefined
    }),
  ])

  const cwd = cwdResult instanceof Error ? process.cwd() : cwdResult
  const gitInfo = gitInfoResult instanceof Error ? undefined : gitInfoResult
  const foregroundProcess = foregroundProcessResult instanceof Error ? undefined : foregroundProcessResult

  // Skip defunct processes (zombie processes)
  if (foregroundProcess?.includes('defunct')) {
    return null
  }

  // Fetch git diff stats (only if we have a cwd and not skipped)
  const gitDiffStats = skipGitDiffStats
    ? undefined
    : await pty.getGitDiffStats(ptyId).catch((e) => {
        console.warn(`Failed to get git diff stats for PTY ${ptyId}:`, e)
        return undefined
      })

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
}

/**
 * Batch fetch PTY metadata with concurrency limiting.
 * Uses async streaming pattern to avoid blocking.
 * 
 * @param pty - The PTY service
 * @param ptyIds - Array of PTY IDs to fetch
 * @param options - Fetch options (skipGitDiffStats)
 * @param batchSize - Max concurrent fetches (default: 8)
 */
export async function* batchFetchPtyMetadata(
  pty: PtyService,
  ptyIds: PtyId[],
  options: FetchPtyMetadataOptions = {},
  batchSize = 8
): AsyncGenerator<PtyMetadata, void, unknown> {
  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < ptyIds.length; i += batchSize) {
    const batch = ptyIds.slice(i, i + batchSize)
    
    // Fetch batch in parallel
    const results = await Promise.all(
      batch.map(id => fetchPtyMetadata(pty, id, options))
    )
    
    // Yield valid results as they complete
    for (const result of results) {
      if (result !== null) {
        yield result
      }
    }
  }
}

/**
 * Fetch metadata for a single PTY by ID with error handling.
 * Returns PtyMetadataError on failure instead of null.
 */
export async function fetchPtyMetadataSafe(
  pty: PtyService,
  ptyId: PtyId,
  options: FetchPtyMetadataOptions = {}
): Promise<PtyMetadata | PtyMetadataError | null> {
  try {
    const result = await fetchPtyMetadata(pty, ptyId, options)
    return result
  } catch (e) {
    return new PtyMetadataError({ 
      operation: 'fetch',
      ptyId, 
      reason: e instanceof Error ? e.message : String(e) 
    })
  }
}
