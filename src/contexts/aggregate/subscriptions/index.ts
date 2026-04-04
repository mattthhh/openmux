/**
 * Subscription management for Aggregate View.
 */

export type {
  SubscriptionManager,
  RefreshState,
  RefreshFlagKey,
  PtyOwnership,
  CurrentSessionHints,
  CurrentSessionPty,
  TitleChangeHandler,
  LifecycleEvent,
  LifecycleHandlers,
  SubscriptionSetupDeps,
  SubscriptionManagerDeps,
} from './types';

export { createSubscriptionManager, createRefreshState } from './types';

export { createLifecycleHandlers, type LifecycleHandlerDeps } from './lifecycle';

export { createTitleChangeHandler, type TitleChangeEvent } from './title-handler';

export {
  setupSubscriptions,
  createGitRepoChangeRefresh,
  createActivityBasedRefresh,
  cleanupSubscriptions,
} from './setup';
