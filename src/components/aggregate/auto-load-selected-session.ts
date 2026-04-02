import type { FlattenedTreeItem, PendingPtyInsertion } from '../../contexts/aggregate-view-types';
import type { PendingAggregatePaneFocus } from './pending-pane-focus';

export function getSelectedSessionIdForAutoLoad(params: {
  selectedItem: FlattenedTreeItem | undefined;
  pendingPtyInsertion: PendingPtyInsertion | null;
  pendingPaneFocus: PendingAggregatePaneFocus | null;
}): string | null {
  const { selectedItem, pendingPtyInsertion, pendingPaneFocus } = params;

  // While aggregate is in the middle of creating/focusing a new pane, selection may
  // transiently land on session headers/placeholders. Treat those as bookkeeping, not
  // as user intent to materialize some other session.
  if (pendingPtyInsertion || pendingPaneFocus) {
    return null;
  }

  if (!selectedItem) {
    return null;
  }

  if (selectedItem.node.type === 'session' && selectedItem.node.loadState.status === 'unloaded') {
    return selectedItem.node.session.id;
  }

  if (
    selectedItem.node.type === 'placeholder' &&
    selectedItem.node.message === '...' &&
    selectedItem.parentSessionId
  ) {
    return selectedItem.parentSessionId;
  }

  return null;
}
