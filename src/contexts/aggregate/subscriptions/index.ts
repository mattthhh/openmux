/**
 * Subscription management for Aggregate View.
 * 
 * Exports:
 * - Subscription types and factory functions
 * - Lifecycle handlers (handlePtyCreated, handlePtyDestroyed)
 * - Title change handler
 * - Subscription setup and cleanup
 */

// Types
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

// Factory functions
export { 
  createSubscriptionManager, 
  createRefreshState 
} from './types';

// Lifecycle handlers
export { 
  createLifecycleHandlers,
  type LifecycleHandlerDeps,
} from './lifecycle';

// Title handler
export { 
  createTitleChangeHandler,
  type TitleChangeEvent,
} from './title-handler';

// Setup and cleanup
export { 
  setupSubscriptions, 
  cleanupSubscriptions,
  type SubscriptionSetupDeps as SetupDeps,
} from './setup';
