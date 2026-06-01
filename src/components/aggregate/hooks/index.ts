/**
 * Aggregate view hooks
 *
 * Custom hooks extracted from AggregateView.tsx for clean separation of concerns.
 */

export { useVimMode, type VimHandlers } from './useVimMode';
export { useEmulatorCache } from './useEmulatorCache';
export {
  useActivitySubscriptions,
  type ActivitySubscriptionError,
} from './useActivitySubscriptions';
export { useSessionDrag, type DragState } from './useSessionDrag';
export { useAggregatePreviewSupport } from './useAggregatePreviewSupport';
export { useShimmerStateVersion } from './useShimmerRenderTime';
export { useShimmerPostProcess } from './useShimmerPostProcess';
