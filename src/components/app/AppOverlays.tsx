/**
 * App overlay stack extracted from App.
 */

import { useLayout, useOverlays } from '../../contexts';
import { useSelection } from '../../contexts/SelectionContext';
import { useAggregateView } from '../../contexts/AggregateViewContext';
import { DEFAULT_COMMAND_PALETTE_COMMANDS, type CommandPaletteCommand } from '../../core/command-palette';
import {
  StatusBar,
  CopyNotification,
  ConfirmationDialog,
} from '../index';
import { SessionPicker } from '../SessionPicker';
import { SearchOverlay } from '../SearchOverlay';
import { AggregateView } from '../AggregateView';
import { CommandPalette } from '../CommandPalette';
import { PaneRenameOverlay } from '../PaneRenameOverlay';
import { WorkspaceLabelOverlay } from '../WorkspaceLabelOverlay';
import { TemplateOverlay } from '../TemplateOverlay';
import { calculateLayoutDimensions } from '../aggregate';

interface AppOverlaysProps {
  width: number;
  height: number;
  onCommandPaletteExecute: (command: CommandPaletteCommand) => void;
  onToggleConsole?: () => void;
}

export function AppOverlays(props: AppOverlaysProps) {
  const selection = useSelection();
  const layout = useLayout();
  const { state: aggregateState } = useAggregateView();
  const overlays = useOverlays();

  return (
    <>
      <StatusBar
        width={props.width}
        showCommandPalette={overlays.commandPaletteState.show}
        showPaneRename={overlays.paneRenameState.show}
        showWorkspaceLabel={overlays.workspaceLabelState.show}
        overlayVimMode={overlays.overlayVimMode()}
        updateLabel={overlays.updateLabel()}
      />

      <AggregateView
        width={props.width}
        height={props.height}
        onRequestQuit={overlays.confirmationHandlers.handleRequestQuit}
        onDetach={overlays.handleDetach}
        onRequestKillPty={overlays.confirmationHandlers.handleRequestKillPty}
        onToggleCommandPalette={overlays.toggleCommandPalette}
        onToggleConsole={props.onToggleConsole}
        onVimModeChange={overlays.setAggregateVimMode}
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
        commands={DEFAULT_COMMAND_PALETTE_COMMANDS}
        state={overlays.commandPaletteState}
        setState={overlays.setCommandPaletteState}
        onExecute={props.onCommandPaletteExecute}
        onVimModeChange={overlays.setCommandPaletteVimMode}
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
