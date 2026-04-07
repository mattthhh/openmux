/**
 * App Action Handlers - callbacks for App component actions
 */
import type { Accessor, Setter } from 'solid-js';
import type { ConfirmationType } from '../../core/types';

export interface ConfirmationState {
  visible: boolean;
  type: ConfirmationType;
}

export interface ActionHandlersDeps {
  confirmationState: Accessor<ConfirmationState>;
  setConfirmationState: Setter<ConfirmationState>;
  pendingKillPtyId: Accessor<string | null>;
  setPendingKillPtyId: Setter<string | null>;
  closePane: () => void;
  getFocusedPtyId: () => string | undefined;
  destroyPTY: (ptyId: string) => Promise<void>;
  enterConfirmMode: () => void;
  exitConfirmMode: () => void;
  saveSession: () => Promise<void>;
  destroyRenderer: () => void;
  newPane: (type?: 'shell') => void;
  pasteToFocused: () => Promise<void>;
  togglePicker: () => void;
  toggleConsole: () => void;
  openAggregateView: () => void;
  enterSearchMode: (ptyId: string) => Promise<void>;
  clearAllSelections: () => void;
  getFocusedCwd: () => Promise<string | null>;
  disposeRuntime: () => Promise<void>;
}

export interface ActionHandlers {
  handleNewPane: () => void;
  handlePaste: () => void;
  handleQuit: () => Promise<void>;
  handleRequestQuit: () => void;
  handleRequestClosePane: () => void;
  handleRequestKillPty: (ptyId: string) => void;
  handleConfirmAction: () => Promise<void>;
  handleCancelConfirmation: () => void;
  handleToggleSessionPicker: () => void;
  handleToggleConsole: () => void;
  handleToggleAggregateView: () => void;
  handleEnterSearch: () => Promise<void>;
  pendingCwdRef: string | null;
}
