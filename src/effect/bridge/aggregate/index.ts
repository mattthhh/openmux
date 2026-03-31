/**
 * Aggregate Bridge
 * Modular architecture for PTY listing with metadata for aggregate view
 *
 * @module aggregate
 */

// Types
export type {
  PtyMetadata,
  FetchPtyMetadataOptions,
  SessionWithPtys,
  VisualTreeNode,
  ListSessionsWithPtysOptions,
  ListAllPtysOptions,
  LoadSessionPtysResult,
  SessionPtyCacheEntry,
} from './types';

// Cache
export {
  SessionPtyCache,
  sessionPtyCache,
  aggregateSessionMappings,
  clearAllCaches,
  invalidateSessionCache,
  removeAggregateSessionMappingForPty,
  DEFAULT_CACHE_MAX_AGE_MS,
  asPtyId,
} from './cache/session-pty-cache';

// Metadata fetching
export { fetchPtyMetadata, batchFetchPtyMetadata, fetchPtyMetadataSafe } from './metadata/fetch';

// Session listing
export { listSessionsWithPtys, listSessionsWithPtysWithService } from './sessions/list';

// Lazy loading
export {
  loadSessionPtys,
  loadSessionPtysWithService,
  loadSessionPtysOnDemand,
  getAggregateSessionPtyMapping,
} from './sessions/lazy-load';

// Tree building
export {
  buildSessionTreeNodes,
  countTreeNodes,
  countTotalPtys,
  findPtyNode,
  findSessionNode,
} from './tree/build';

// Backward-compatible API
export {
  getPtyMetadata,
  getPtyMetadataWithService,
  listAllPtysWithMetadata,
  listAllPtysWithMetadataWithService,
} from './api/backward-compat';
