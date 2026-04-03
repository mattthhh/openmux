/**
 * Backward-Compatible API
 * Re-exports from aggregate modules with global services singleton
 */

import type { PtyService } from '../../../services/Pty';
import type { PtyMetadata, ListAllPtysOptions } from '../types';
import {
  AggregateBridgeError,
  ServicesNotInitializedError,
  PtyMetadataError,
} from '../../../errors';
import { getPtyService, hasServices } from '../../services-instance';
import { fetchPtyMetadata } from '../metadata/fetch';
import { asPtyId } from '../cache/session-pty-cache';

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
): Promise<PtyMetadata | null | ServicesNotInitializedError> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'aggregate PTY metadata fetch' });
  }
  return getPtyMetadataWithService(getPtyService(), ptyId, options);
}

/**
 * List all PTYs with their metadata.
 * Fetches metadata in parallel for better performance.
 *
 * Backward-compatible version that uses global services singleton.
 *
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtyIds(): Promise<
  string[] | AggregateBridgeError | ServicesNotInitializedError
> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'aggregate PTY id list' });
  }
  return listAllPtyIdsWithService(getPtyService());
}

export async function listAllPtysWithMetadata(
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[] | AggregateBridgeError | ServicesNotInitializedError> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'aggregate PTY list' });
  }
  return listAllPtysWithMetadataWithService(getPtyService(), options);
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
  });
}

/**
 * List all PTYs with their metadata with explicit service.
 * Fetches metadata in parallel for better performance.
 *
 * @param pty - The PTY service
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtyIdsWithService(
  pty: PtyService
): Promise<string[] | AggregateBridgeError> {
  try {
    return (await pty.listAll()).map((id) => String(id));
  } catch (error) {
    return new AggregateBridgeError({
      operation: 'list PTY ids',
      target: 'all-ptys',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function listAllPtysWithMetadataWithService(
  pty: PtyService,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[] | AggregateBridgeError> {
  try {
    const ptyIds = await pty.listAll();

    const results = await Promise.all(
      ptyIds.map((id) => fetchPtyMetadata(pty, id, { skipGitDiffStats: options.skipGitDiffStats }))
    );

    return results.filter((meta): meta is PtyMetadata => meta !== null);
  } catch (error) {
    return new AggregateBridgeError({
      operation: 'list PTYs with metadata',
      target: 'all-ptys',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
