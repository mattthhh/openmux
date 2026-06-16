/**
 * StatusBar - bottom status bar showing sessions, workspaces and mode
 */

import { Show, createMemo } from 'solid-js';
import { useTheme } from '../contexts/ThemeContext';
import { useLayout } from '../contexts/LayoutContext';
import { useKeyboard } from '../contexts/KeyboardContext';
import { useSession, useSessionState } from '../contexts/SessionContext';
import type { KeyMode, WorkspaceId, LayoutMode } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import type { VimInputMode } from '../core/vim-sequences';

interface StatusBarProps {
  width: number;
  showCommandPalette?: boolean;
  showPaneRename?: boolean;
  showWorkspaceLabel?: boolean;
  overlayVimMode?: VimInputMode | null;
  updateLabel?: string | null;
}

export function StatusBar(props: StatusBarProps) {
  const theme = useTheme();
  const layout = useLayout();
  const { state: kbState } = useKeyboard();
  const session = useSession();
  const sessionState = useSessionState();
  const commandColor = () => theme.searchAccentColor;
  const sessionColor = () => theme.pane.focusedBorderColor;

  // Truncate session name if too long
  const displaySessionName = () => {
    const sessionName = sessionState.activeSession?.name ?? 'default';
    const maxSessionNameLen = 15;
    return sessionName.length > maxSessionNameLen
      ? sessionName.slice(0, maxSessionNameLen - 1) + '…'
      : sessionName;
  };

  return (
    <box
      style={{
        height: 1,
        width: props.width,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
      backgroundColor="transparent"
    >
      {/* Left section: app name, session name and workspace tabs */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg={sessionColor()}>[{displaySessionName()}]</text>
        <WorkspaceTabs
          populatedWorkspaces={layout.populatedWorkspaces}
          activeWorkspaceId={layout.state.activeWorkspaceId}
          workspaces={layout.state.workspaces}
        />
      </box>

      {/* Right section: Mode and layout mode */}
      <box style={{ flexDirection: 'row', gap: 1 }}>
        <ModeIndicator mode={kbState.mode} />
        <Show when={props.showCommandPalette}>
          <text fg={commandColor()}>[COMMAND]</text>
        </Show>
        <Show when={props.showPaneRename}>
          <text fg={sessionColor()}>[RENAME]</text>
        </Show>
        <Show when={props.showWorkspaceLabel}>
          <text fg={sessionColor()}>[LABEL]</text>
        </Show>
        <Show when={sessionState.showSessionPicker}>
          <text fg={sessionColor()}>[SESSIONS]</text>
        </Show>
        <Show when={session.showTemplateOverlay}>
          <text fg={sessionColor()}>[TEMPLATES]</text>
        </Show>
        <Show when={props.overlayVimMode}>
          <text
            fg={props.overlayVimMode === 'insert' ? theme.statusBar.successColor : sessionColor()}
          >
            {props.overlayVimMode === 'insert' ? '[INSERT]' : '[NORMAL]'}
          </text>
        </Show>
        <Show when={props.updateLabel}>
          <text fg={theme.statusBar.successColor}>{props.updateLabel}</text>
        </Show>
        <Show when={(layout.activeWorkspace.synchronizedPanes ?? false)}>
          <text fg={theme.pane.focusedBorderColor}>[SYNC PANES]</text>
        </Show>
        <Show when={layout.activeWorkspace.zoomed}>
          <text fg={theme.ui.mutedText}>[ZOOMED]</text>
        </Show>
        <LayoutModeIndicator mode={layout.activeWorkspace.layoutMode} />
      </box>
    </box>
  );
}

interface ModeIndicatorProps {
  mode: KeyMode;
}

function ModeIndicator(props: ModeIndicatorProps) {
  const theme = useTheme();
  const modeLabels: Record<KeyMode, string> = {
    normal: '',
    prefix: '[PREFIX]',
    search: '[SEARCH]',
    copy: '[COPY]',
    aggregate: '[GLOBAL]',
    confirm: '[CONFIRM]',
    move: '[MOVE]',
  };
  const modeColor = () => {
    switch (props.mode) {
      case 'search':
        return theme.searchAccentColor;
      case 'copy':
        return theme.pane.copyModeBorderColor;
      case 'confirm':
        return theme.pane.urgentBorderColor;
      default:
        return theme.ui.mutedText;
    }
  };

  return (
    <Show when={props.mode !== 'normal'}>
      <text fg={modeColor()}>{modeLabels[props.mode]}</text>
    </Show>
  );
}

interface LayoutModeIndicatorProps {
  mode: LayoutMode;
}

function LayoutModeIndicator(props: LayoutModeIndicatorProps) {
  const theme = useTheme();
  const modeLabels: Record<LayoutMode, string> = {
    vertical: '[VERTICAL]',
    horizontal: '[HORIZONTAL]',
    stacked: '[STACKED]',
  };

  return <text fg={theme.ui.mutedText}>{modeLabels[props.mode]}</text>;
}

interface WorkspaceTabsProps {
  populatedWorkspaces: WorkspaceId[];
  activeWorkspaceId: WorkspaceId;
  workspaces: Workspaces;
}

function WorkspaceTabs(props: WorkspaceTabsProps) {
  const theme = useTheme();

  // Memoize tabs string to avoid recomputation on unrelated re-renders
  const tabs = createMemo(() => {
    if (props.populatedWorkspaces.length === 0) return null;
    return props.populatedWorkspaces
      .map((id) => {
        const label = props.workspaces[id]?.label?.trim();
        const labelSuffix = label ? `:${label}` : '';
        const isActive = id === props.activeWorkspaceId;
        return isActive ? `[${id}${labelSuffix}]` : ` ${id}${labelSuffix} `;
      })
      .join('');
  });

  return (
    <Show when={tabs()} fallback={<text fg={theme.ui.mutedText}>No workspaces</text>}>
      <text fg={theme.statusBar.activeTabColor}>{tabs()}</text>
    </Show>
  );
}
