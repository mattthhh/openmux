/**
 * Confirmation dialog handlers for App
 * Handles request, confirm, and cancel actions for various confirmation dialogs
 */

import type { ConfirmationType } from '../../core/types';
import type { Accessor, Setter } from 'solid-js';
import { deferMacrotask } from '../../core/scheduling';

export interface ConfirmationState {
  visible: boolean;
  type: ConfirmationType;
}

export interface ConfirmationHandlerDeps {
  confirmationState: Accessor<ConfirmationState>;
  setConfirmationState: Setter<ConfirmationState>;
  pendingKillPtyId: Accessor<string | null>;
  setPendingKillPtyId: Setter<string | null>;

  closePane: () => void;
  getFocusedPtyId: () => string | undefined;

  destroyPTY: (ptyId: string, options?: { skipPaneClose?: boolean }) => void;

  enterConfirmMode: (type: ConfirmationType) => void;
  exitConfirmMode: () => void;

  onQuit: () => Promise<void>;

  onConfirmApplyTemplate?: () => Promise<void> | void;
  onCancelApplyTemplate?: () => void;
  onConfirmOverwriteTemplate?: () => Promise<void> | void;
  onCancelOverwriteTemplate?: () => void;
  onConfirmDeleteTemplate?: () => Promise<void> | void;
  onCancelDeleteTemplate?: () => void;
  onConfirmDeleteSession?: () => Promise<void> | void;
  onCancelDeleteSession?: () => void;

}

/**
 * Create confirmation dialog handlers
 */
export function createConfirmationHandlers(deps: ConfirmationHandlerDeps) {
  const {
    confirmationState,
    setConfirmationState,
    pendingKillPtyId,
    setPendingKillPtyId,
    closePane,
    getFocusedPtyId,
    destroyPTY,
    enterConfirmMode,
    exitConfirmMode,
    onQuit,
    onConfirmApplyTemplate,
    onCancelApplyTemplate,
    onConfirmOverwriteTemplate,
    onCancelOverwriteTemplate,
    onConfirmDeleteTemplate,
    onCancelDeleteTemplate,
    onConfirmDeleteSession,
    onCancelDeleteSession,
  } = deps;

  /**
   * Request close pane (show confirmation)
   */
  const handleRequestClosePane = () => {
    enterConfirmMode('close_pane');
    setConfirmationState({ visible: true, type: 'close_pane' });
  };

  /**
   * Request quit (show confirmation)
   */
  const handleRequestQuit = () => {
    enterConfirmMode('exit');
    setConfirmationState({ visible: true, type: 'exit' });
  };

  /**
   * Request kill PTY (show confirmation) - from aggregate view
   */
  const handleRequestKillPty = (ptyId: string) => {
    setPendingKillPtyId(ptyId);
    enterConfirmMode('kill_pty');
    setConfirmationState({ visible: true, type: 'kill_pty' });
  };

  /**
   * Request template apply (show confirmation)
   */
  const handleRequestApplyTemplate = () => {
    enterConfirmMode('apply_template');
    setConfirmationState({ visible: true, type: 'apply_template' });
  };

  /**
   * Request template delete (show confirmation)
   */
  const handleRequestDeleteTemplate = () => {
    enterConfirmMode('delete_template');
    setConfirmationState({ visible: true, type: 'delete_template' });
  };

  /**
   * Request session delete (show confirmation)
   */
  const handleRequestDeleteSession = () => {
    enterConfirmMode('delete_session');
    setConfirmationState({ visible: true, type: 'delete_session' });
  };

  /**
   * Request template overwrite (show confirmation)
   */
  const handleRequestOverwriteTemplate = () => {
    enterConfirmMode('overwrite_template');
    setConfirmationState({ visible: true, type: 'overwrite_template' });
  };

  /**
   * Handle confirmation action
   */
  const handleConfirmAction = async () => {
    const { type } = confirmationState();
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });

    if (type === 'close_pane') {
      // Get the focused pane's PTY ID before closing (so we can destroy it)
      const ptyId = getFocusedPtyId();
      closePane();
      // Destroy the PTY to kill the terminal process
      // Defer to macrotask to avoid blocking animations
      // Pass skipPaneClose=true since we already closed the pane above
      if (ptyId) {
        deferMacrotask(() => {
          destroyPTY(ptyId, { skipPaneClose: true });
        });
      }
    } else if (type === 'exit') {
      await onQuit();
    } else if (type === 'kill_pty') {
      // Kill PTY from aggregate view
      const ptyId = pendingKillPtyId();
      if (ptyId) {
        destroyPTY(ptyId);
        setPendingKillPtyId(null);
      }
    } else if (type === 'apply_template') {
      await onConfirmApplyTemplate?.();
    } else if (type === 'overwrite_template') {
      await onConfirmOverwriteTemplate?.();
    } else if (type === 'delete_template') {
      await onConfirmDeleteTemplate?.();
    } else if (type === 'delete_session') {
      await onConfirmDeleteSession?.();
    }
  };

  /**
   * Handle cancel confirmation
   */
  const handleCancelConfirmation = () => {
    const { type } = confirmationState();
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });
    setPendingKillPtyId(null);
    if (type === 'apply_template') {
      onCancelApplyTemplate?.();
    }
    if (type === 'overwrite_template') {
      onCancelOverwriteTemplate?.();
    }
    if (type === 'delete_template') {
      onCancelDeleteTemplate?.();
    }
    if (type === 'delete_session') {
      onCancelDeleteSession?.();
    }
  };

  return {
    handleRequestClosePane,
    handleRequestQuit,
    handleRequestKillPty,
    handleRequestApplyTemplate,
    handleRequestOverwriteTemplate,
    handleRequestDeleteTemplate,
    handleRequestDeleteSession,
    handleConfirmAction,
    handleCancelConfirmation,
  };
}
