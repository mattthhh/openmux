import { createEffect } from 'solid-js';
import type { Rectangle } from '../../core/types';
import type { CommandPaletteState } from '../CommandPalette';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';
import type { SessionState } from '../../core/operations/session-actions';
import type { TemplateSession } from '../../effect/models';
import type { CommandPaletteCommand } from '../../core/command-palette';
import type { SessionMetadata } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { ClipRect, KittyPaneLayer } from '../../terminal/kitty-graphics';
import type { SearchContextValue } from '../../contexts/search/types';

type ClipRectProvider = (width: number, height: number, ...args: any[]) => Rectangle | null;

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
  aggregateState: { showAggregateView: boolean; selectedPtyId: string | null; previewZoomed: boolean };
  commandPaletteState: CommandPaletteState;
  commandPaletteCommands: CommandPaletteCommand[];
  paneRenameState: PaneRenameState;
  workspaceLabelState: WorkspaceLabelState;
  confirmationVisible: () => boolean;
  kittyRenderer: {
    setClipRects: (rects: ClipRect[]) => void;
    setVisibleLayers: (layers: Iterable<KittyPaneLayer>) => void;
  };
  getSessionPickerRect: ClipRectProvider;
  getTemplateOverlayRect: ClipRectProvider;
  getCommandPaletteRect: ClipRectProvider;
  getPaneRenameRect: ClipRectProvider;
  getWorkspaceLabelRect: ClipRectProvider;
  getSearchOverlayRect: ClipRectProvider;
  getConfirmationRect: ClipRectProvider;
  getCopyNotificationRect: ClipRectProvider;
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
    paneRenameState,
    workspaceLabelState,
    confirmationVisible,
    kittyRenderer,
    getSessionPickerRect,
    getTemplateOverlayRect,
    getCommandPaletteRect,
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

    pushRect(getSessionPickerRect(w, h, sessionState.showSessionPicker, session.filteredSessions.length));
    pushRect(getTemplateOverlayRect(w, h, session.showTemplateOverlay, session.templates.length, layout.state.workspaces));
    pushRect(getCommandPaletteRect(w, h, commandPaletteState, commandPaletteCommands));
    pushRect(getPaneRenameRect(w, h, paneRenameState));
    pushRect(getWorkspaceLabelRect(w, h, workspaceLabelState));
    pushRect(getSearchOverlayRect(w, h, Boolean(search.searchState)));
    pushRect(getConfirmationRect(w, h, confirmationVisible()));
    pushRect(getCopyNotificationRect(w, h, selection.copyNotification, aggregateState, layout.panes));

    kittyRenderer.setClipRects(rects);
    kittyRenderer.setVisibleLayers(aggregateState.showAggregateView ? ['overlay'] : ['base']);
  });
}
