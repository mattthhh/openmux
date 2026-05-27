/**
 * App overlay stack extracted from App.
 */

import { Show } from 'solid-js';
import { useLayout, useOverlays } from '../../contexts';
import { useSelection } from '../../contexts/SelectionContext';
import { useAggregateView } from '../../contexts/AggregateViewContext';
import { type CommandPaletteCommand } from '../../core/command-palette';
import type { FileEntry } from '../../core/file-opener';
import type { DiffTarget } from '../../core/diff-opener';
import { StatusBar, CopyNotification, ConfirmationDialog } from '../index';
import { SessionPicker } from '../SessionPicker';
import { SearchOverlay } from '../SearchOverlay';
import { AggregateView, type AggregateStateActions } from '../AggregateView';
import { CommandPalette } from '../CommandPalette';
import { FileOpener } from '../FileOpener';
import { DiffOpener } from '../DiffOpener';
import { PaneRenameOverlay } from '../PaneRenameOverlay';
import { WorkspaceLabelOverlay } from '../WorkspaceLabelOverlay';
import { TemplateOverlay } from '../TemplateOverlay';
import { calculateLayoutDimensions } from '../aggregate';

interface AppOverlaysProps {
  width: number;
  height: number;
  commands: CommandPaletteCommand[];
  onCommandPaletteExecute: (command: CommandPaletteCommand) => void;
  onFileOpenerSelect: (entry: FileEntry) => void;
  onToggleFileOpener?: () => void;
  onDiffOpenerSelect: (target: DiffTarget) => void;
  onToggleDiffOpener?: () => void;
  onToggleConsole?: () => void;
  /** Called when the aggregate state manager initializes with its action methods. */
  onAggregateActionsReady?: (actions: AggregateStateActions) => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  const selection = useSelection();
  const layout = useLayout();
  const { state: aggregateState } = useAggregateView();
  const overlays = useOverlays();

  // Hide the workspace status bar when aggregate view is open — it has its own
  // footer hints row and rendering both causes overlapping text.
  const statusBarHidden = () => aggregateState.showAggregateView;

  return (
    <>
      <Show when={!statusBarHidden()}>
        <StatusBar
          width={props.width}
          showCommandPalette={overlays.commandPaletteState.show}
          showPaneRename={overlays.paneRenameState.show}
          showWorkspaceLabel={overlays.workspaceLabelState.show}
          overlayVimMode={overlays.overlayVimMode()}
          updateLabel={overlays.updateLabel()}
        />
      </Show>

      <AggregateView
        width={props.width}
        height={props.height}
        onRequestQuit={overlays.confirmationHandlers.handleRequestQuit}
        onDetach={overlays.handleDetach}
        onRequestKillPty={overlays.confirmationHandlers.handleRequestKillPty}
        onToggleCommandPalette={overlays.toggleCommandPalette}
        onToggleFileOpener={props.onToggleFileOpener ?? overlays.toggleFileOpener}
        onToggleDiffOpener={props.onToggleDiffOpener ?? overlays.toggleDiffOpener}
        onToggleConsole={props.onToggleConsole}
        onVimModeChange={overlays.setAggregateVimMode}
        onActionsReady={props.onAggregateActionsReady}
      />

      <SessionPicker
        width={props.width}
        height={props.height}
        onRequestDeleteConfirm={overlays.requestSessionDeleteConfirm}
        onVimModeChange={overlays.setSessionPickerVimMode}
      />

      <TemplateOverlay
        width={props.width}
        height={props.height}
        onRequestApplyConfirm={overlays.requestTemplateApplyConfirm}
        onRequestOverwriteConfirm={overlays.requestTemplateOverwriteConfirm}
        onRequestDeleteConfirm={overlays.requestTemplateDeleteConfirm}
        onVimModeChange={overlays.setTemplateOverlayVimMode}
      />

      <CommandPalette
        width={props.width}
        height={props.height}
        commands={props.commands}
        state={overlays.commandPaletteState}
        setState={overlays.setCommandPaletteState}
        onExecute={props.onCommandPaletteExecute}
        onVimModeChange={overlays.setCommandPaletteVimMode}
      />

      <FileOpener
        width={props.width}
        height={props.height}
        state={overlays.fileOpenerState}
        setState={overlays.setFileOpenerState}
        onSelect={props.onFileOpenerSelect}
        onVimModeChange={overlays.setFileOpenerVimMode}
      />

      <DiffOpener
        width={props.width}
        height={props.height}
        state={overlays.diffOpenerState}
        setState={overlays.setDiffOpenerState}
        onSelect={props.onDiffOpenerSelect}
        onVimModeChange={overlays.setDiffOpenerVimMode}
      />

      <PaneRenameOverlay
        width={props.width}
        height={props.height}
        state={overlays.paneRenameState}
        setState={overlays.setPaneRenameState}
        onVimModeChange={overlays.setPaneRenameVimMode}
      />

      <WorkspaceLabelOverlay
        width={props.width}
        height={props.height}
        state={overlays.workspaceLabelState}
        setState={overlays.setWorkspaceLabelState}
        onVimModeChange={overlays.setWorkspaceLabelVimMode}
      />

      <SearchOverlay width={props.width} height={props.height} />

      <ConfirmationDialog
        visible={overlays.confirmationState().visible}
        type={overlays.confirmationState().type}
        width={props.width}
        height={props.height}
        onConfirm={overlays.confirmationHandlers.handleConfirmAction}
        onCancel={overlays.confirmationHandlers.handleCancelConfirmation}
      />

      <CopyNotification
        visible={selection.copyNotification.visible}
        status={selection.copyNotification.status}
        charCount={selection.copyNotification.charCount}
        paneRect={(() => {
          const ptyId = selection.copyNotification.ptyId;
          if (!ptyId) return null;

          if (aggregateState.showAggregateView && aggregateState.selectedPtyId === ptyId) {
            const aggLayout = calculateLayoutDimensions({
              width: props.width,
              height: props.height,
              listPaneRatio: aggregateState.previewZoomed ? 0 : undefined,
            });
            return {
              x: aggLayout.listPaneWidth,
              y: 0,
              width: aggLayout.previewPaneWidth,
              height: aggLayout.contentHeight,
            };
          }

          return layout.panes.find((p) => p.ptyId === ptyId)?.rectangle ?? null;
        })()}
      />
    </>
  );
}
