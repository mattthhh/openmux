/**
 * Refresh operations for Aggregate View.
 *
 * Exports:
 * - Full refresh (refreshPtysOnce)
 * - Subset refresh (refreshPtysSubsetOnce, refreshPtysSubset)
 * - Initial load (initialLoadOnce)
 * - RefreshGuard for managing refresh state
 * - Session utilities
 */

// Types
export type {
  AggregatePtyMetadata,
  ResolvedPty,
  SessionSummary,
  RefreshDependencies,
  RefreshResult,
  BatchRefreshOptions,
  SubsetRefreshOptions,
  FullRefreshDeps,
  SubsetRefreshDeps,
  InitialLoadDeps,
} from './types';

// Guard
export { RefreshGuard } from './guard';

// Refresh operations
export { refreshPtysOnce } from './full-refresh';
export { ptyMetadataToInfo } from '../pty-info';
export { refreshPtysSubsetOnce, refreshPtysSubset } from './subset-refresh';
export { initialLoadOnce } from './initial-load';

// Session utilities
export {
  collectSerializedPaneIds,
  buildSessionPaneOrder,
  findWorkspaceIdForPane,
} from './session-utils';

// Backward compatibility
export {
  createAggregateViewRefreshers,
  type CreateRefreshersParams,
  type RefreshersResult,
} from './compat';
