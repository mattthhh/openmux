/**
 * Types for subscription management in Aggregate View.
 */

import type { PtyTitleChangeEvent } from '../../effect/bridge/pty-bridge';

/** Subscription manager holding all active subscription cleanup functions */
export interface SubscriptionManager {
  lifecycle: (() => void) | null;
  titleChange: (() => void) | null;
  polling: (() => void) | null;
}

/** Refresh state for tracking ongoing operations */
export interface RefreshState {
  refreshInProgress: boolean;
  subsetRefreshInProgress: boolean;
  pendingFullRefresh: boolean;
  pendingSubsetPtyIds: Set<string>;
}

/** Keys for boolean refresh flags */
export type RefreshFlagKey = 'refreshInProgress' | 'subsetRefreshInProgress';

/** PTY ownership information for session/pane/workspace mapping */
export interface PtyOwnership {
  sessionId: string;
  paneId?: string;
  workspaceId?: number;
}

/** Session hints for current session context */
export interface CurrentSessionHints {
  sessionId: string | null;
  lastActiveWorkspaceId?: number;
  focusedPaneId?: string;
}

/** Current session PTY reference */
export interface CurrentSessionPty {
  ptyId: string;
  paneId: string;
  workspaceId: number;
  title?: string;
}

/** Title change event handler type */
export type TitleChangeHandler = (event: { ptyId: string; title: string }) => void;

/** Lifecycle event types */
export interface LifecycleEvent {
  type: 'created' | 'destroyed';
  ptyId: string;
}

/** Lifecycle handlers interface */
export interface LifecycleHandlers {
  handlePtyCreated: (ptyId: string) => Promise<void>;
  handlePtyDestroyed: (ptyId: string) => void;
}

/** Dependencies for subscription setup */
export interface SubscriptionSetupDeps {
  subscriptions: SubscriptionManager;
  subscriptionsEpoch: { value: number };
  refreshPtys: () => Promise<void>;
  refreshPtysSubset: (ptyIds: string[]) => Promise<void>;
  handleTitleChange: TitleChangeHandler;
  lifecycleHandlers: LifecycleHandlers;
}

/** Dependencies for creating subscription manager */
export interface SubscriptionManagerDeps {
  showAggregateView: boolean;
  allPtys: Array<{ ptyId: string }>;
}

/**
 * Create a fresh subscription manager.
 */
export function createSubscriptionManager(): SubscriptionManager {
  return {
    lifecycle: null,
    titleChange: null,
    polling: null,
  };
}

/**
 * Create initial refresh state.
 */
export function createRefreshState(): RefreshState {
  return {
    refreshInProgress: false,
    subsetRefreshInProgress: false,
    pendingFullRefresh: false,
    pendingSubsetPtyIds: new Set(),
  };
}
