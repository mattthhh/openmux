/**
 * PTY Service Module Index
 * Clean exports for all PTY-related functionality
 */

// Types
export type { InternalPtySession } from './types';
export type { PtyService, PtyTitleChangeEvent, GetPtyGitInfoOptions } from './interface';
export type { PtyServiceConfig } from './prod';

// State management
export { PtyState } from './state';

// Service implementations
export { createPtyService } from './prod';
export { createShimPtyService } from './shim';
export { createTestPtyService } from './test';

// Factories (for advanced usage)
export { createOperations, type OperationsDeps } from './operations';
export { createSubscriptions, type SubscriptionsDeps } from './subscriptions';
export {
  createSession,
  type SessionFactoryDeps,
  type CreateSessionOptions,
} from './session-factory';
export {
  createSubscriptionRegistry,
  type SubscriptionRegistry,
  type SubscriptionId,
} from './subscription-manager';

// Helpers
export {
  getGitInfo,
  getGitDiffStats,
  disposeGitHelpers,
  type GitInfo,
  type GitDiffStats,
} from './helpers';

// Notification utilities
export { getCurrentScrollState, notifySubscribers, notifyScrollSubscribers } from './notification';

// Data handling
export { createDataHandler } from './data-handler';

// Query setup
export { setupQueryPassthrough } from './query-setup';
