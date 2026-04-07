/**
 * Terminal context module exports
 */

export { createScrollHandlers } from './scroll-handlers';
export { createPtyLifecycleHandlers, type PtyLifecycleDeps } from './pty-lifecycle';
export { createCacheAccessors, type CacheAccessorDeps } from './cache-accessors';
export { createHostColorSync, type HostColorSync, type HostColorSyncDeps } from './host-color-sync';
