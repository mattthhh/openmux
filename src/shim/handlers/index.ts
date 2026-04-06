/**
 * Shim Handlers Index
 * Modular shim server handlers organized by concern
 */

// Types
export type {
  WithPty,
  ShimServerOptions,
  SendEvent,
  SendResponse,
  SendError,
  ShimHandlerContext,
  AttachContext,
  BootstrapOptions,
} from './types';

// Event handling
export {
  shouldSuppressBootstrappingEvent,
  isCurrentAttach,
  createEventSender,
  sendDetached,
} from './events';

// Mapping management
export {
  registerMapping,
  removeMappingForPty,
  getPaneForPty,
  clearAllMappings,
  getPtyIdsForSession,
} from './mapping';

// Replay
export { sendFullSnapshot, replayPtyState, allowBootstrapReplay } from './replay';

// Subscription management
export {
  subscribeToPty,
  unsubscribeFromPty,
  subscribeAllPtys,
  cleanupCurrentClientBindings,
} from './subscription';

// Lifecycle and titles
export { handleLifecycle, handleTitles } from './lifecycle';

// Bootstrap and attach
export { startAttachBootstrap, attachClient, detachClient, applyHostColors } from './bootstrap';
