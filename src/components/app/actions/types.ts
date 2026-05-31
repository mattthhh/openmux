/**
 * Shared types for the app action layer.
 *
 * These types are used by both app-actions.ts and the action modules
 * under ./actions/ to avoid circular dependencies.
 */

import type { DiffTarget } from '../../../core/diff-opener';

/** Callbacks for aggregate-view-scoped actions. */
export interface AggregateCommandActions {
  togglePreviewZoom: () => void;
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
  killSelectedPty: (ptyId: string) => void;
  navigateUp: () => void;
  navigateDown: () => void;
  navigateToPrevPty: () => void;
  navigateToNextPty: () => void;
  toggleShowInactive: () => void;
  openPtyPicker: () => void;
  toggleSessionExpanded: (sessionId: string) => void;
  expandAllSessions: () => void;
  collapseAllSessions: () => void;
  enterPreviewSearch: () => Promise<void>;
  enterPreviewCopyMode: () => void;
  renameSelectedPty: () => void;
  pasteToPreviewPty: () => void;
  getSelectedPtyId: () => string | null;
  closeAggregateView: () => void;
}
