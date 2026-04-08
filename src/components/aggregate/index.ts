/**
 * Aggregate view module exports
 */

export { InteractivePreview } from './InteractivePreview';
export { findPtyLocation, findPaneLocation } from './utils';
export { createAggregateKeyboardHandler, type AggregateKeyboardDeps } from './keyboard-handlers';
export { createAggregateMouseHandlers, type MouseHandlerDeps } from './mouse-handlers';
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
export { ListPane, type ListPaneProps } from './ListPane';
export { PreviewPane, type PreviewPaneProps, type PreviewMouseHandlers } from './PreviewPane';

// Controller components
export {
  AggregateKeyboardController,
  AggregateMouseController,
  AggregateStateManager,
  type AggregateKeyboardControllerProps,
  type AggregateMouseControllerProps,
} from './controllers';

// Hooks
export {
  useVimMode,
  useEmulatorCache,
  useActivitySubscriptions,
  useSessionDrag,
  type VimHandlers,
  type ActivitySubscriptionError,
  type DragState,
} from './hooks';
