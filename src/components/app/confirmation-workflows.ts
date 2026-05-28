/**
 * Confirmation workflows for App (template/session requests + kill/quit actions).
 */

import { createSignal } from 'solid-js';
import type { ConfirmationType } from '../../core/types';
import { createConfirmationHandlers, type ConfirmationState } from './confirmation-handlers';
import { createTemplatePendingActions } from './template-pending-actions';
import { createSessionPendingActions } from './session-pending-actions';

export interface ConfirmationWorkflowDeps {
  closePane: () => void;
  getFocusedPtyId: () => string | undefined;
  destroyPTY: (ptyId: string, options?: { skipPaneClose?: boolean }) => void;
  enterConfirmMode: (type: ConfirmationType) => void;
  exitConfirmMode: () => void;
  onQuit: () => Promise<void>;
}

export interface ConfirmationWorkflows {
  confirmationState: () => ConfirmationState;
  confirmationHandlers: ReturnType<typeof createConfirmationHandlers>;
  requestTemplateApplyConfirm: (applyTemplate: () => Promise<void>) => void;
  requestTemplateOverwriteConfirm: (overwriteTemplate: () => Promise<void>) => void;
  requestTemplateDeleteConfirm: (deleteTemplate: () => Promise<void>) => void;
  requestSessionDeleteConfirm: (deleteSession: () => Promise<void>) => void;
}

export function createConfirmationWorkflows(deps: ConfirmationWorkflowDeps): ConfirmationWorkflows {
  const [confirmationState, setConfirmationState] = createSignal<ConfirmationState>({
    visible: false,
    type: 'close_pane',
  });
  const [pendingKillPtyId, setPendingKillPtyId] = createSignal<string | null>(null);
  const templatePending = createTemplatePendingActions();
  const sessionPending = createSessionPendingActions();

  const confirmationHandlers = createConfirmationHandlers({
    confirmationState,
    setConfirmationState,
    pendingKillPtyId,
    setPendingKillPtyId,
    closePane: deps.closePane,
    getFocusedPtyId: deps.getFocusedPtyId,
    destroyPTY: deps.destroyPTY,
    enterConfirmMode: deps.enterConfirmMode,
    exitConfirmMode: deps.exitConfirmMode,
    onQuit: deps.onQuit,
    onConfirmApplyTemplate: templatePending.confirmApply,
    onCancelApplyTemplate: templatePending.cancelApply,
    onConfirmOverwriteTemplate: templatePending.confirmOverwrite,
    onCancelOverwriteTemplate: templatePending.cancelOverwrite,
    onConfirmDeleteTemplate: templatePending.confirmDelete,
    onCancelDeleteTemplate: templatePending.cancelDelete,
    onConfirmDeleteSession: sessionPending.confirmDelete,
    onCancelDeleteSession: sessionPending.cancelDelete,
  });

  const requestTemplateApplyConfirm = (applyTemplate: () => Promise<void>) => {
    templatePending.setPendingApply(() => applyTemplate);
    confirmationHandlers.handleRequestApplyTemplate();
  };

  const requestTemplateOverwriteConfirm = (overwriteTemplate: () => Promise<void>) => {
    templatePending.setPendingOverwrite(() => overwriteTemplate);
    confirmationHandlers.handleRequestOverwriteTemplate();
  };

  const requestTemplateDeleteConfirm = (deleteTemplate: () => Promise<void>) => {
    templatePending.setPendingDelete(() => deleteTemplate);
    confirmationHandlers.handleRequestDeleteTemplate();
  };

  const requestSessionDeleteConfirm = (deleteSession: () => Promise<void>) => {
    sessionPending.setPendingDelete(() => deleteSession);
    confirmationHandlers.handleRequestDeleteSession();
  };

  return {
    confirmationState,
    confirmationHandlers,
    requestTemplateApplyConfirm,
    requestTemplateOverwriteConfirm,
    requestTemplateDeleteConfirm,
    requestSessionDeleteConfirm,
  };
}
