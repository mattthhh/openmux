import { createEffect } from 'solid-js';
import type { Rectangle } from '../../core/types';
import type { CommandPaletteState } from '../CommandPalette';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';
import type { FileOpenerState } from '../FileOpener';
import type { DiffOpenerState } from '../DiffOpener';
import type { SessionState } from '../../core/operations/session-actions';
import type { TemplateSession } from '../../effect/models';
import type { CommandPaletteCommand } from '../../core/command-palette';
import type { SessionMetadata } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { ClipRect, KittyPaneLayer } from '../../terminal/kitty-graphics';
import type { SearchContextValue } from '../../contexts/search/types';

type SessionPickerRectFn = (
  width: number,
  height: number,
  show: boolean,
  itemCount: number
) => Rectangle | null;
type TemplateOverlayRectFn = (
  width: number,
  height: number,
  show: boolean,
  templateCount: number,
  workspaces: Workspaces
) => Rectangle | null;
type CommandPaletteRectFn = (
  width: number,
  height: number,
  state: CommandPaletteState,
  commands: CommandPaletteCommand[]
) => Rectangle | null;
type PaneRenameRectFn = (width: number, height: number, state: PaneRenameState) => Rectangle | null;
type WorkspaceLabelRectFn = (
  width: number,
  height: number,
  state: WorkspaceLabelState
) => Rectangle | null;
type SearchOverlayRectFn = (width: number, height: number, hasSearch: boolean) => Rectangle | null;
type ConfirmationRectFn = (width: number, height: number, visible: boolean) => Rectangle | null;
type CopyNotificationRectFn = (
  width: number,
  height: number,
  notification: { visible: boolean; ptyId: string | null },
  aggregateState: {
    showAggregateView: boolean;
    selectedPtyId: string | null;
    previewZoomed: boolean;
  },
  panes: Array<{ ptyId?: string | null; rectangle?: Rectangle | null }>
) => Rectangle | null;

type FileOpenerRectFn = (width: number, height: number, state: FileOpenerState) => Rectangle | null;
type DiffOpenerRectFn = (width: number, height: number, state: DiffOpenerState) => Rectangle | null;

export function setupOverlayClipRects(params: {
  getWidth: () => number;
  getHeight: () => number;
  sessionState: SessionState;
  session: {
    showTemplateOverlay: boolean;
    templates: TemplateSession[];
    filteredSessions: SessionMetadata[];
  };
  layout: {
    state: { workspaces: Workspaces };
    panes: Array<{ ptyId?: string | null; rectangle?: Rectangle | null }>;
  };
  search: SearchContextValue;
  selection: { copyNotification: { visible: boolean; ptyId: string | null } };
  aggregateState: {
    showAggregateView: boolean;
    selectedPtyId: string | null;
    previewZoomed: boolean;
  };
  commandPaletteState: CommandPaletteState;
  commandPaletteCommands: CommandPaletteCommand[] | (() => CommandPaletteCommand[]);
  fileOpenerState: FileOpenerState;
  diffOpenerState: DiffOpenerState;
  paneRenameState: PaneRenameState;
  workspaceLabelState: WorkspaceLabelState;
  confirmationVisible: () => boolean;
  kittyRenderer: {
    setClipRects: (rects: ClipRect[]) => void;
    setVisibleLayers: (layers: Iterable<KittyPaneLayer>) => void;
  };
  getSessionPickerRect: SessionPickerRectFn;
  getTemplateOverlayRect: TemplateOverlayRectFn;
  getCommandPaletteRect: CommandPaletteRectFn;
  getFileOpenerRect: FileOpenerRectFn;
  getDiffOpenerRect: DiffOpenerRectFn;
  getPaneRenameRect: PaneRenameRectFn;
  getWorkspaceLabelRect: WorkspaceLabelRectFn;
  getSearchOverlayRect: SearchOverlayRectFn;
  getConfirmationRect: ConfirmationRectFn;
  getCopyNotificationRect: CopyNotificationRectFn;
}): void {
  const {
    getWidth,
    getHeight,
    sessionState,
    session,
    layout,
    search,
    selection,
    aggregateState,
    commandPaletteState,
    commandPaletteCommands,
    fileOpenerState,
    diffOpenerState,
    paneRenameState,
    workspaceLabelState,
    confirmationVisible,
    kittyRenderer,
    getSessionPickerRect,
    getTemplateOverlayRect,
    getCommandPaletteRect,
    getFileOpenerRect,
    getDiffOpenerRect,
    getPaneRenameRect,
    getWorkspaceLabelRect,
    getSearchOverlayRect,
    getConfirmationRect,
    getCopyNotificationRect,
  } = params;

  createEffect(() => {
    const w = getWidth();
    const h = getHeight();
    const rects: Rectangle[] = [];
    const pushRect = (rect: Rectangle | null) => {
      if (rect && rect.width > 0 && rect.height > 0) {
        rects.push(rect);
      }
    };

    pushRect(
      getSessionPickerRect(w, h, sessionState.showSessionPicker, session.filteredSessions.length)
    );
    pushRect(
      getTemplateOverlayRect(
        w,
        h,
        session.showTemplateOverlay,
        session.templates.length,
        layout.state.workspaces
      )
    );
    pushRect(
      getCommandPaletteRect(
        w,
        h,
        commandPaletteState,
        typeof commandPaletteCommands === 'function'
          ? commandPaletteCommands()
          : commandPaletteCommands
      )
    );
    pushRect(getFileOpenerRect(w, h, fileOpenerState));
    pushRect(getDiffOpenerRect(w, h, diffOpenerState));
    pushRect(getPaneRenameRect(w, h, paneRenameState));
    pushRect(getWorkspaceLabelRect(w, h, workspaceLabelState));
    pushRect(getSearchOverlayRect(w, h, Boolean(search.searchState)));
    pushRect(getConfirmationRect(w, h, confirmationVisible()));
    pushRect(
      getCopyNotificationRect(w, h, selection.copyNotification, aggregateState, layout.panes)
    );

    kittyRenderer.setClipRects(rects);
    kittyRenderer.setVisibleLayers(aggregateState.showAggregateView ? ['overlay'] : ['base']);
  });
}
