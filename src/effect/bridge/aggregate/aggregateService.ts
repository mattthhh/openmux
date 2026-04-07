/**
 * Cohesive aggregate bridge service.
 *
 * This is the explicit-dependency entry point for aggregate view operations.
 * Callers construct it with the PTY + session services they already own instead
 * of reaching through the global bridge singleton from deep helper modules.
 */

import type { SessionManager } from '../../services/SessionManager';
import type { PtyService } from '../../services/Pty';
import type { SessionError } from '../../errors';
import { AggregateBridgeError, ServicesNotInitializedError } from '../../errors';
import { getPtyService, getSessionManager, hasServices } from '../services-instance';

import type {
  ListAllPtysOptions,
  ListSessionsWithPtysOptions,
  LoadSessionPtysResult,
  PtyMetadata,
  SessionPtyMapping,
  SessionWithPtys,
  VisualTreeNode,
} from './types';
import { asPtyId } from './cache/session-pty-cache';
import { fetchPtyMetadata } from './metadata/fetch';
import { listSessionsWithPtysWithService } from './sessions/list';
import {
  getAggregateSessionPtyMapping,
  loadSessionPtysOnDemandWithService,
  loadSessionPtysWithService,
} from './sessions/lazy-load';
import {
  buildSessionTreeNodes,
  countTreeNodes,
  countTotalPtys,
  findPtyNode,
  findSessionNode,
} from './tree/build';

export interface AggregateServiceDeps {
  pty: PtyService;
  sessionManager: SessionManager;
}

export interface AggregateService {
  getPtyMetadata: (
    ptyId: string,
    options?: ListAllPtysOptions
  ) => Promise<PtyMetadata | null | AggregateBridgeError>;
  listAllPtyIds: () => Promise<string[] | AggregateBridgeError>;
  listAllPtysWithMetadata: (
    options?: ListAllPtysOptions
  ) => Promise<PtyMetadata[] | AggregateBridgeError>;
  listSessionsWithPtys: (options?: ListSessionsWithPtysOptions) => Promise<SessionWithPtys[]>;
  loadSessionPtys: (
    sessionId: string,
    options?: { skipGitDiffStats?: boolean }
  ) => Promise<PtyMetadata[] | null>;
  loadSessionPtysOnDemand: (
    sessionId: string,
    options?: { createIfMissing?: boolean }
  ) => Promise<LoadSessionPtysResult | SessionError | AggregateBridgeError>;
  getAggregateSessionPtyMapping: (sessionId: string) => Promise<SessionPtyMapping | undefined>;
  buildSessionTreeNodes: (sessions: SessionWithPtys[]) => VisualTreeNode[];
  countTreeNodes: (nodes: VisualTreeNode[]) => number;
  countTotalPtys: (sessions: SessionWithPtys[]) => number;
  findPtyNode: typeof findPtyNode;
  findSessionNode: typeof findSessionNode;
}

function toAggregateBridgeError(params: {
  operation: string;
  target: string;
  cause: unknown;
}): AggregateBridgeError {
  const { operation, target, cause } = params;
  return new AggregateBridgeError({
    operation,
    target,
    reason: cause instanceof Error ? cause.message : String(cause),
    cause: cause instanceof Error ? cause : undefined,
  });
}

export async function getPtyMetadataWithService(
  pty: PtyService,
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null | AggregateBridgeError> {
  const result = await fetchPtyMetadata(pty, asPtyId(ptyId), {
    skipGitDiffStats: options.skipGitDiffStats,
  }).catch((cause: unknown) =>
    toAggregateBridgeError({
      operation: 'get PTY metadata',
      target: ptyId,
      cause,
    })
  );

  return result;
}

export async function listAllPtyIdsWithService(
  pty: PtyService
): Promise<string[] | AggregateBridgeError> {
  const ptyIds = await pty.listAll().catch((cause: unknown) =>
    toAggregateBridgeError({
      operation: 'list PTY ids',
      target: 'all-ptys',
      cause,
    })
  );
  if (ptyIds instanceof Error) {
    return ptyIds;
  }

  return ptyIds.map((id: string) => String(id));
}

export async function listAllPtysWithMetadataWithService(
  pty: PtyService,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[] | AggregateBridgeError> {
  const ptyIds = await pty.listAll().catch((cause: unknown) =>
    toAggregateBridgeError({
      operation: 'list PTYs with metadata',
      target: 'all-ptys',
      cause,
    })
  );
  if (ptyIds instanceof Error) {
    return ptyIds;
  }

  const results = await Promise.all(
    ptyIds.map((id: string) =>
      fetchPtyMetadata(pty, asPtyId(id), {
        skipGitDiffStats: options.skipGitDiffStats,
      }).catch((cause: unknown) =>
        toAggregateBridgeError({
          operation: 'fetch PTY metadata',
          target: String(id),
          cause,
        })
      )
    )
  );

  const firstError = results.find(
    (result: PtyMetadata | null | AggregateBridgeError): result is AggregateBridgeError =>
      result instanceof Error
  );
  if (firstError) {
    return firstError;
  }

  return results.filter(
    (meta: PtyMetadata | null | AggregateBridgeError): meta is PtyMetadata => meta !== null
  );
}

/**
 * Singleton-backed convenience wrappers for app/runtime callers.
 *
 * The lower-level helpers above take explicit services, while these exports keep
 * the bridge ergonomic for UI code that already runs inside the initialized runtime.
 */
export async function getPtyMetadata(
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null | AggregateBridgeError | ServicesNotInitializedError> {
  if (!hasServices()) {
    return new ServicesNotInitializedError({ operation: 'aggregate PTY metadata fetch' });
  }

  return getPtyMetadataWithService(getPtyService(), ptyId, options);
}

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

export async function listSessionsWithPtys(
  options: ListSessionsWithPtysOptions = {}
): Promise<SessionWithPtys[]> {
  if (!hasServices()) {
    console.warn('Services not initialized, cannot list sessions with PTYs');
    return [];
  }

  return listSessionsWithPtysWithService(getPtyService(), getSessionManager(), options);
}

export function createAggregateService({
  pty,
  sessionManager,
}: AggregateServiceDeps): AggregateService {
  return {
    getPtyMetadata: (ptyId, options = {}) => getPtyMetadataWithService(pty, ptyId, options),
    listAllPtyIds: () => listAllPtyIdsWithService(pty),
    listAllPtysWithMetadata: (options = {}) => listAllPtysWithMetadataWithService(pty, options),
    listSessionsWithPtys: (options = {}) =>
      listSessionsWithPtysWithService(pty, sessionManager, options),
    loadSessionPtys: (sessionId, options = {}) =>
      loadSessionPtysWithService(pty, sessionManager, sessionId, options),
    loadSessionPtysOnDemand: (sessionId, options) =>
      loadSessionPtysOnDemandWithService(pty, sessionManager, sessionId, options),
    getAggregateSessionPtyMapping,
    buildSessionTreeNodes,
    countTreeNodes,
    countTotalPtys,
    findPtyNode,
    findSessionNode,
  };
}
