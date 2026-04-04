/**
 * PTY Metadata Fetching
 * Functions for fetching PTY metadata with batching and error handling
 */

import type { PtyService } from '../../../services/Pty';
import type { PtyId } from '../../../types';
import type { PtyMetadata, FetchPtyMetadataOptions } from '../types';
import { PtyMetadataError } from '../../../errors';

function getEmptyGitMetadata() {
  return {
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
  };
}

/**
 * Fetch metadata for a single PTY.
 * Returns null if PTY is invalid or defunct.
 *
 * Git metadata is intentionally omitted here. Aggregate view hydrates git state
 * from a cwd-based repo cache so every row uses the same source of truth.
 */
export async function fetchPtyMetadata(
  pty: PtyService,
  ptyId: PtyId,
  _options: FetchPtyMetadataOptions = {}
): Promise<PtyMetadata | null> {
  // Get session - trust Pty service for validity
  const session = await pty.getSession(ptyId);
  if (session instanceof Error || session.pid === 0) {
    return null;
  }

  // Fetch cwd + foreground process only. Git is hydrated later from the final
  // cwd snapshot to avoid mixing multiple sources of truth.
  const [cwdResult, foregroundProcessResult] = await Promise.all([
    pty.getCwd(ptyId),
    pty.getForegroundProcess(ptyId).catch((e) => {
      console.warn(`Failed to get foreground process for PTY ${ptyId}:`, e);
      return undefined;
    }),
  ]);

  const cwd = (() => {
    if (!(cwdResult instanceof Error)) return cwdResult;
    console.warn(`Failed to get cwd for PTY ${ptyId}, using session cwd fallback:`, cwdResult);
    return session.cwd;
  })();
  const foregroundProcess =
    foregroundProcessResult instanceof Error ? undefined : foregroundProcessResult;

  // Skip defunct processes (zombie processes)
  // Type guard: ensure foregroundProcess is a string before calling includes
  if (typeof foregroundProcess === 'string' && foregroundProcess.includes('defunct')) {
    return null;
  }

  return {
    ptyId,
    cwd,
    ...getEmptyGitMetadata(),
    foregroundProcess,
    shell: session.shell,
    title: undefined, // Title is set dynamically via title change events
    workspaceId: undefined, // Will be enriched by AggregateView
    paneId: undefined, // Will be enriched by AggregateView
  };
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
    const batch = ptyIds.slice(i, i + batchSize);

    // Fetch batch in parallel
    const results = await Promise.all(batch.map((id) => fetchPtyMetadata(pty, id, options)));

    // Yield valid results as they complete
    for (const result of results) {
      if (result !== null) {
        yield result;
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
    const result = await fetchPtyMetadata(pty, ptyId, options);
    return result;
  } catch (e) {
    return new PtyMetadataError({
      operation: 'fetch',
      ptyId,
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
