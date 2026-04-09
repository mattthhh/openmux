/**
 * Session Listing
 * Functions for listing sessions with their associated PTY metadata
 */

import type { PtyService } from '../../../services/Pty';
import type { SessionManager } from '../../../services/SessionManager';
import type { SessionWithPtys, ListSessionsWithPtysOptions, PtyMetadata } from '../types';
import { sessionPtyCache, asPtyId } from '../cache/session-pty-cache';
import { batchFetchPtyMetadata } from '../metadata/fetch';
import type { SessionMetadata } from '../../../models';
import { PtyMetadataError } from '../../../errors';

/**
 * PTY metadata with session context attached.
 * Used when aggregating PTYs by session in the tree view.
 */
interface PtyMetadataWithSession extends PtyMetadata {
  sessionId: string;
  sessionMetadata: SessionMetadata;
}

/**
 * List all sessions with their PTYs for the aggregate view.
 *
 * - Returns session metadata immediately (fast)
 * - For active/loaded sessions: fetches full PTY metadata
 * - For unloaded sessions: returns 'unloaded' placeholder
 * - Uses async streaming to avoid blocking
 * - Caches session→PTY mappings for performance
 *
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @param options.batchSize - Max concurrent PTY fetches (default: 8)
 * @returns Array of sessions with their PTY info
 */

/**
 * List all sessions with their PTYs using explicit services.
 *
 * @param pty - The PTY service
 * @param sessionManager - The session manager service
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @param options.batchSize - Max concurrent PTY fetches (default: 8)
 * @returns Array of sessions with their PTY info
 */
export async function listSessionsWithPtysWithService(
  pty: PtyService,
  sessionManager: SessionManager,
  options: ListSessionsWithPtysOptions = {}
): Promise<SessionWithPtys[]> {
  const { skipGitDiffStats, batchSize = 8 } = options;

  // Step 1: Get all session metadata (fast, non-blocking)
  const sessionsResult = await sessionManager.listSessions();
  if (sessionsResult instanceof Error) {
    console.warn('Failed to list sessions:', sessionsResult);
    return [];
  }
  const sessions = [...sessionsResult];

  // Step 2: Get active session ID
  const activeSessionId = sessionManager.getActiveSessionId();

  // Step 3: Get all active PTY IDs from PTY service (fast)
  const allActivePtyIds = await pty.listAll();
  const activePtyIdSet = new Set(allActivePtyIds.map((id) => String(id)));

  // Step 4: Build session list with async PTY fetching
  const result: SessionWithPtys[] = [];
  const pendingLoads: Promise<void>[] = [];

  for (const session of sessions) {
    const isActive = session.id === activeSessionId;
    const cached = sessionPtyCache.get(session.id);

    // If we have cached data, use it
    if (cached && cached.isLoaded) {
      // Filter to only active PTYs
      const activePtyIdsInSession = [...cached.ptyIds].filter((id) =>
        activePtyIdSet.has(String(id))
      );

      if (activePtyIdsInSession.length === 0 && !isActive) {
        // Session has no active PTYs and is not active - treat as unloaded
        result.push({
          session,
          ptys: 'unloaded',
          isActive: false,
          ptyCount: cached.ptyIds.size,
        });
      } else {
        // Fetch PTY metadata asynchronously
        const ptys: PtyMetadataWithSession[] = [];

        // Start async fetch but don't block
        const loadPromise = (async () => {
          try {
            for await (const metadata of batchFetchPtyMetadata(
              pty,
              activePtyIdsInSession,
              { skipGitDiffStats },
              batchSize
            )) {
              const metadataWithSession: PtyMetadataWithSession = {
                ...metadata,
                sessionId: session.id,
                sessionMetadata: session,
              };
              ptys.push(metadataWithSession);
            }
          } catch (cause: unknown) {
            const error = new PtyMetadataError({
              operation: 'batch-fetch-metadata',
              ptyId: session.id,
              reason: cause instanceof Error ? cause.message : String(cause),
              cause,
            });
            console.warn(`Failed to fetch PTYs for session ${session.id}:`, error.message);
          }
        })();

        pendingLoads.push(loadPromise);

        result.push({
          session,
          ptys,
          isActive,
          ptyCount: activePtyIdsInSession.length,
        });
      }
      continue;
    }

    // No cache - need to determine if session is loaded
    if (isActive) {
      // Active session: all active PTYs belong to this session
      const ptys: PtyMetadataWithSession[] = [];

      // For active session, use all active PTY IDs
      // (The active session owns all currently running PTYs)
      const activeSessionPtyIds = [...activePtyIdSet];

      // Fetch metadata for all active PTYs
      const loadPromise = (async () => {
        try {
          for await (const metadata of batchFetchPtyMetadata(
            pty,
            activeSessionPtyIds.map((id) => asPtyId(id)),
            { skipGitDiffStats },
            batchSize
          )) {
            const metadataWithSession: PtyMetadataWithSession = {
              ...metadata,
              sessionId: session.id,
              sessionMetadata: session,
            };
            ptys.push(metadataWithSession);
          }

          // Update cache with actual PTY IDs (not pane IDs)
          sessionPtyCache.set(
            session.id,
            activeSessionPtyIds.map((id) => asPtyId(id)),
            true
          );
        } catch (cause: unknown) {
          const error = new PtyMetadataError({
            operation: 'batch-fetch-active-session',
            ptyId: session.id,
            reason: cause instanceof Error ? cause.message : String(cause),
            cause,
          });
          console.warn(
            `[listSessionsWithPtys] Failed to load PTYs for active session ${session.id}:`,
            error.message
          );
        }
      })();

      pendingLoads.push(loadPromise);

      result.push({
        session,
        ptys,
        isActive: true,
        ptyCount: activeSessionPtyIds.length,
      });
    } else {
      // Inactive session: try to get summary or use placeholder
      const sessionInfoResult = await sessionManager.getSessionInfo(session.id);
      const ptyCount =
        sessionInfoResult instanceof Error || sessionInfoResult === null
          ? 0
          : sessionInfoResult.summary.paneCount;

      result.push({
        session,
        ptys: 'unloaded',
        isActive: false,
        ptyCount,
      });
    }
  }

  // Wait for all async loads to complete
  await Promise.all(pendingLoads);

  // Update ptyCount for active sessions after load
  for (const item of result) {
    if (Array.isArray(item.ptys)) {
      item.ptyCount = item.ptys.length;
    }
  }

  return result;
}
