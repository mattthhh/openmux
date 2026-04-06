/**
 * Aggregate bridge re-export.
 *
 * Prefer `createAggregateService()` from `src/effect/bridge/aggregate/` so
 * callers pass services explicitly.
 */

export * from './aggregate';

export * as types from './aggregate/types';
export * as cache from './aggregate/cache/session-pty-cache';
export * as metadata from './aggregate/metadata/fetch';
export * as sessions from './aggregate/sessions/list';
export * as lazyLoad from './aggregate/sessions/lazy-load';
export * as tree from './aggregate/tree/build';
export * as service from './aggregate/aggregateService';
