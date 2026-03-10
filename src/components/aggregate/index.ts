/**
 * Aggregate view module exports
 */

export { PtyCard } from './PtyCard';
export { InteractivePreview } from './InteractivePreview';
export { findPtyLocation, findPaneLocation } from './utils';
export {
  createAggregateKeyboardHandler,
  type AggregateKeyboardDeps,
} from './keyboard-handlers';
export {
  createAggregateMouseHandlers,
  type MouseHandlerDeps,
} from './mouse-handlers';
export {
  borderStyleMap,
  calculateLayoutDimensions,
  getHintsText,
  getFilterText,
  calculateFooterWidths,
  type LayoutConfig,
  type LayoutDimensions,
} from './layout-utils';

export { truncateHint } from '../overlay-hints';

// Tree-based rendering components
export { SessionTreeNode } from './SessionTreeNode';
export { PtyTreeRow } from './PtyTreeRow';
export { PlaceholderRow } from './PlaceholderRow';
export type { SessionTreeNodeProps } from './SessionTreeNode';
export type { PtyTreeRowProps } from './PtyTreeRow';
export type { PlaceholderRowProps } from './PlaceholderRow';

// Pane components
export { ListPane, type ListPaneProps, type ListLayout, type ListViewport } from './ListPane';
export { PreviewPane, type PreviewPaneProps, type PreviewMouseHandlers } from './PreviewPane';

// Hooks
export {
  useVimMode,
  useEmulatorCache,
  useActivitySubscriptions,
  useSessionDrag,
  type VimHandlers,
  type EmulatorCacheError,
  type ActivitySubscriptionError,
  type DragState,
} from './hooks';
