/**
 * Types for refresh operations in Aggregate View.
 */

import type { PtyInfo } from '../../../contexts/aggregate-view-types';
import type { SessionMetadata } from '../../../effect/models';
import type { PtyMetadata } from '../../../effect/bridge/aggregate/types';
import type { PtyOwnership, CurrentSessionHints } from '../subscriptions/types';

/** Extended PTY metadata with session information */
export interface AggregatePtyMetadata extends PtyMetadata {
  sessionId?: string;
  sessionMetadata?: SessionMetadata;
}

/** Resolved PTY with ownership and metadata */
export interface ResolvedPty {
  metadata: AggregatePtyMetadata;
  ownership: PtyOwnership;
  sessionMetadata: SessionMetadata;
}

/** Session summary information */
export interface SessionSummary {
  workspaceCount: number;
  paneCount: number;
}

/** Dependencies for refresh operations */
export interface RefreshDependencies {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
  getCurrentSessionPtys?: () => Array<{
    ptyId: string;
    paneId: string;
    workspaceId: number;
    title?: string;
  }>;
}

/** Result of a refresh operation */
export type RefreshResult = void | Error;

/** Batch refresh options */
export interface BatchRefreshOptions {
  skipGitDiffStats?: boolean;
}

/** Subset refresh options */
export interface SubsetRefreshOptions {
  forceRefresh?: boolean;
}

/** Dependencies for full refresh */
export interface FullRefreshDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
}

/** Dependencies for subset refresh */
export interface SubsetRefreshDeps {
  resolvePtyOwnership: (ptyId: string) => PtyOwnership | null;
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPaneOrder: () => Map<string, number> | null;
}

/** Dependencies for initial load */
export interface InitialLoadDeps {
  getCurrentSessionHints: () => CurrentSessionHints;
  getCurrentSessionPtys?: () => Array<{
    ptyId: string;
    paneId: string;
    workspaceId: number;
    title?: string;
  }>;
}
