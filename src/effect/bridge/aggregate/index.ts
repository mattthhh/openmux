/**
 * Aggregate bridge public API.
 *
 * Explicit service construction lives in `aggregateService.ts`. Lower-level modules
 * remain available for focused imports and tests.
 */

export type {
  PtyMetadata,
  FetchPtyMetadataOptions,
  SessionWithPtys,
  VisualTreeNode,
  ListSessionsWithPtysOptions,
  ListAllPtysOptions,
  LoadSessionPtysResult,
  SessionPtyCacheEntry,
  SessionPtyMapping,
} from './types';

export {
  SessionPtyCache,
  sessionPtyCache,
  aggregateSessionMappings,
  removeAggregateSessionMappingForPty,
  DEFAULT_CACHE_MAX_AGE_MS,
  asPtyId,
} from './cache/session-pty-cache';

export { fetchPtyMetadata, batchFetchPtyMetadata } from './metadata/fetch';

export { listSessionsWithPtysWithService } from './sessions/list';

export {
  loadSessionPtysWithService,
  loadSessionPtysOnDemand,
  loadSessionPtysOnDemandWithService,
  getAggregateSessionPtyMapping,
} from './sessions/lazy-load';

export {
  buildSessionTreeNodes,
  countTreeNodes,
  countTotalPtys,
  findPtyNode,
  findSessionNode,
} from './tree/build';

export type { AggregateService, AggregateServiceDeps } from './aggregateService';
export {
  createAggregateService,
  getPtyMetadata,
  getPtyMetadataWithService,
  listAllPtyIds,
  listAllPtyIdsWithService,
  listAllPtysWithMetadata,
  listAllPtysWithMetadataWithService,
  listSessionsWithPtys,
} from './aggregateService';
