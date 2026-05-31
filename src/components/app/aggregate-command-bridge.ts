/**
 * Bridge hook that assembles the AggregateCommandActions object.
 *
 * Most actions come directly from AggregateViewContext. Actions that
 * depend on component-level state (handleNewPaneInSession, handleJumpToPty,
 * handleOpenFileInSession, handleOpenDiffInSession) are injected via the
 * onActionsReady callback from AggregateStateManager.
 */

import { createSignal } from 'solid-js';
import type { DiffTarget } from '../../core/diff-opener';
import type { AggregateCommandActions } from './actions/types';
import type { AggregateViewContextValue } from '../../contexts/aggregate-view-types';
import type { LayoutContextValue } from '../../contexts/LayoutContext';
import type { TerminalContextValue } from '../../contexts/TerminalContext';
import type { SessionContextValue } from '../../contexts/SessionContext';
import type { TitleContextValue } from '../../contexts/TitleContext';
import type { KeyboardContextValue } from '../../contexts/keyboard/types';
import type { CopyModeContextValue } from '../../contexts/copy-mode/types';
import type { SelectionContextValue } from '../../contexts/SelectionContext';
import type { SearchContextValue } from '../../contexts/search/types';
import type { OverlayContextValue } from '../../contexts/OverlayContext';
import { resolveAggregatePreviewPtyId, findPtyLocation } from '../aggregate/utils';

/** Methods provided by AggregateStateManager via onActionsReady */
interface AggregateStateManagerActions {
  handleNewPaneInSession: () => Promise<void>;
  handleJumpToPty: () => Promise<boolean>;
  handleOpenFileInSession: (entry: {
    absolutePath: string;
    isFolderAction: boolean;
    rootDir?: string;
  }) => Promise<void>;
  handleOpenDiffInSession: (
    target: DiffTarget,
    rootDir: string,
    fullCommand: string
  ) => Promise<void>;
}

export interface AggregateActionsDeps {
  aggregateView: AggregateViewContextValue;
  layout: LayoutContextValue;
  terminal: TerminalContextValue;
  session: SessionContextValue;
  titleContext: TitleContextValue;
  keyboardState: KeyboardContextValue;
  copyMode: CopyModeContextValue;
  selection: SelectionContextValue;
  search: SearchContextValue;
  overlays: OverlayContextValue;
}

/**
 * Create the aggregate command actions bridge.
 * Returns:
 *  - actions: the AggregateCommandActions object (for command palette / opener routing)
 *  - onActionsReady: callback for AggregateStateManager's onActionsReady prop
 */
export function createAggregateCommandActionsBridge(deps: AggregateActionsDeps): {
  actions: AggregateCommandActions;
  onActionsReady: (actions: AggregateStateManagerActions) => void;
} {
  const {
    aggregateView,
    layout,
    terminal,
    session,
    titleContext,
    keyboardState,
    copyMode,
    selection,
    search,
    overlays,
  } = deps;

  const [managerActions, setManagerActions] = createSignal<AggregateStateManagerActions | null>(
    null
  );

  const resolvePreviewPtyId = () =>
    resolveAggregatePreviewPtyId({
      selectedPtyId: aggregateView.state.selectedPtyId,
      selectedIndex: aggregateView.state.selectedIndex,
      flattenedTree: aggregateView.state.flattenedTree,
      activeSessionId: session.state.activeSessionId,
      workspaces: layout.state.workspaces,
    });

  const actions: AggregateCommandActions = {
    togglePreviewZoom: aggregateView.togglePreviewZoom,
    handleNewPaneInSession: () => managerActions()?.handleNewPaneInSession() ?? Promise.resolve(),
    handleJumpToPty: () => managerActions()?.handleJumpToPty() ?? Promise.resolve(false),
    handleOpenFileInSession: (entry) =>
      managerActions()?.handleOpenFileInSession(entry) ?? Promise.resolve(),
    handleOpenDiffInSession: (target, rootDir, fullCommand) =>
      managerActions()?.handleOpenDiffInSession(target, rootDir, fullCommand) ?? Promise.resolve(),
    killSelectedPty: (ptyId: string) => overlays.confirmationHandlers.handleRequestKillPty(ptyId),
    navigateUp: aggregateView.navigateUp,
    navigateDown: aggregateView.navigateDown,
    navigateToPrevPty: aggregateView.navigateToPrevPty,
    navigateToNextPty: aggregateView.navigateToNextPty,
    toggleShowInactive: aggregateView.toggleShowInactive,
    openPtyPicker: aggregateView.openPtyPicker,
    toggleSessionExpanded: aggregateView.toggleSessionExpanded,
    expandAllSessions: aggregateView.expandAllSessions,
    collapseAllSessions: aggregateView.collapseAllSessions,
    enterPreviewSearch: async () => {
      const ptyId = resolvePreviewPtyId();
      if (!ptyId) return;
      selection.clearAllSelections();
      await search.enterSearchMode(ptyId);
      keyboardState.enterSearchMode();
    },
    enterPreviewCopyMode: () => {
      const ptyId = resolvePreviewPtyId();
      if (!ptyId) return;
      selection.clearAllSelections();
      keyboardState.enterCopyMode();
      copyMode.enterCopyMode(ptyId, (id) => terminal.getTerminalStateSync(id));
    },
    renameSelectedPty: () => {
      const ptyId = aggregateView.state.selectedPtyId;
      if (!ptyId) return;
      const loc = findPtyLocation(ptyId, layout.state.workspaces);
      const paneId = loc?.paneId;
      if (!paneId) return;
      const currentTitle = titleContext.getTitle(paneId) ?? 'shell';
      overlays.setPaneRenameState({
        show: true,
        paneId,
        value: currentTitle,
      });
    },
    pasteToPreviewPty: () => terminal.pasteToFocused(),
    getSelectedPtyId: () => aggregateView.state.selectedPtyId,
    closeAggregateView: aggregateView.closeAggregateView,
  };

  const onActionsReady = (managerActionsFromComponent: AggregateStateManagerActions) => {
    setManagerActions(managerActionsFromComponent);
  };

  return { actions, onActionsReady };
}
