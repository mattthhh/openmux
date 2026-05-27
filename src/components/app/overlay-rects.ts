import type { CommandPaletteCommand } from '../../core/command-palette';
import type { Rectangle } from '../../core/types';
import type { Workspaces } from '../../core/operations/layout-actions';
import { filterCommands } from '../command-palette-utils';
import { buildTemplateSummary } from '../template-overlay/summary';
import { calculateLayoutDimensions } from '../aggregate';
import type { PaneRenameState } from '../PaneRenameOverlay';
import type { WorkspaceLabelState } from '../WorkspaceLabelOverlay';
import type { FileOpenerState } from '../FileOpener';

type CopyNotificationState = {
  visible: boolean;
  ptyId: string | null;
};

type AggregateState = {
  showAggregateView: boolean;
  selectedPtyId: string | null;
  previewZoomed: boolean;
};

type PaneLike = {
  ptyId?: string | null;
  rectangle?: Rectangle | null;
};

export function getSessionPickerRect(
  width: number,
  height: number,
  showSessionPicker: boolean,
  filteredSessionsLength: number
): Rectangle | null {
  if (!showSessionPicker) return null;
  const overlayWidth = Math.max(0, Math.min(60, width - 4));
  const sessionRowCount = Math.max(1, filteredSessionsLength);
  const overlayHeight = Math.max(0, Math.min(sessionRowCount + 6, height - 4));
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = Math.floor((height - overlayHeight) / 2);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getTemplateOverlayRect(
  width: number,
  height: number,
  showTemplateOverlay: boolean,
  templateCount: number,
  workspaces: Workspaces
): Rectangle | null {
  if (!showTemplateOverlay) return null;
  const overlayWidth = Math.max(0, Math.min(72, width - 4));

  const maxListRows = Math.max(1, height - 10);
  const listRows = Math.max(1, Math.min(templateCount, maxListRows));
  const applyHeight = Math.max(0, Math.min(listRows + 6, height - 4));

  const summary = buildTemplateSummary(workspaces);
  const summaryLines =
    summary.workspaceCount === 0 ? 1 : summary.workspaceCount + summary.paneCount;
  const maxSaveSummaryLines = Math.max(0, height - 13);
  const visibleSaveSummary = Math.min(summaryLines, maxSaveSummaryLines);
  const saveSummaryRows = visibleSaveSummary + (summaryLines > maxSaveSummaryLines ? 1 : 0);
  const saveContentRows = 2 + 1 + saveSummaryRows + 2;
  const saveHeight = Math.max(0, Math.min(saveContentRows + 2, height - 4));

  const overlayHeight = Math.max(applyHeight, saveHeight);
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = Math.floor((height - overlayHeight) / 2);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getCommandPaletteRect(
  width: number,
  height: number,
  state: { show: boolean; query: string },
  commands: CommandPaletteCommand[]
): Rectangle | null {
  if (!state.show) return null;
  const overlayWidth = Math.max(0, Math.min(70, width - 4));
  const hasQuery = state.query.trim().length > 0;
  const filteredCommands = filterCommands(commands, state.query);
  const resultCount = filteredCommands.length;
  const showResults = resultCount > 0;

  const listHeight = () => {
    if (!showResults) return 0;
    const maxRows = Math.max(1, height - 7);
    return Math.min(Math.max(1, resultCount), maxRows);
  };

  let overlayHeight = 3;
  if (!hasQuery || !showResults) {
    overlayHeight = 3;
  } else {
    overlayHeight = Math.max(0, Math.min(listHeight() + 3, height - 4));
  }

  const overlayX = Math.floor((width - overlayWidth) / 2);
  const desiredCommandY = Math.floor(height * 0.15);
  const desired = Math.max(0, desiredCommandY - 1);
  const maxY = Math.max(0, height - overlayHeight);
  const overlayY = Math.min(desired, maxY);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getPaneRenameRect(
  width: number,
  height: number,
  state: PaneRenameState
): Rectangle | null {
  if (!state.show) return null;
  const overlayWidth = Math.max(0, Math.min(70, width - 4));
  const overlayHeight = 3;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const desiredCommandY = Math.floor(height * 0.15);
  const desired = Math.max(0, desiredCommandY - 1);
  const maxY = Math.max(0, height - overlayHeight);
  const overlayY = Math.min(desired, maxY);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getWorkspaceLabelRect(
  width: number,
  height: number,
  state: WorkspaceLabelState
): Rectangle | null {
  if (!state.show) return null;
  const overlayWidth = Math.max(0, Math.min(70, width - 4));
  const overlayHeight = 3;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const desiredCommandY = Math.floor(height * 0.15);
  const desired = Math.max(0, desiredCommandY - 1);
  const maxY = Math.max(0, height - overlayHeight);
  const overlayY = Math.min(desired, maxY);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getSearchOverlayRect(
  width: number,
  height: number,
  showSearch: boolean
): Rectangle | null {
  if (!showSearch) return null;
  const overlayWidth = Math.max(0, Math.min(width - 4, 60));
  const overlayHeight = 3;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = height - overlayHeight - 1;
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getConfirmationRect(
  width: number,
  height: number,
  visible: boolean
): Rectangle | null {
  if (!visible) return null;
  const overlayWidth = Math.max(0, Math.min(56, width - 4));
  const overlayHeight = 6;
  const overlayX = Math.floor((width - overlayWidth) / 2);
  const overlayY = Math.floor((height - overlayHeight) / 2);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}

export function getCopyNotificationRect(
  width: number,
  height: number,
  notification: CopyNotificationState,
  aggregateState: AggregateState,
  panes: PaneLike[]
): Rectangle | null {
  if (!notification.visible) return null;
  if (!notification.ptyId) return null;

  let paneRect: Rectangle | null = null;
  if (aggregateState.showAggregateView && aggregateState.selectedPtyId === notification.ptyId) {
    const aggLayout = calculateLayoutDimensions({
      width,
      height,
      listPaneRatio: aggregateState.previewZoomed ? 0 : undefined,
    });
    paneRect = {
      x: aggLayout.listPaneWidth,
      y: 0,
      width: aggLayout.previewPaneWidth,
      height: aggLayout.contentHeight,
    };
  } else {
    paneRect = panes.find((pane) => pane.ptyId === notification.ptyId)?.rectangle ?? null;
  }

  if (!paneRect) return null;
  const toastWidth = 25;
  const toastHeight = 3;
  const left = Math.max(0, paneRect.x + paneRect.width - toastWidth - 2);
  const top = paneRect.y + 1;
  return { x: left, y: top, width: toastWidth, height: toastHeight };
}

export function getFileOpenerRect(
  width: number,
  height: number,
  state: FileOpenerState
): Rectangle | null {
  if (!state.show) return null;
  const overlayWidth = Math.max(0, Math.min(70, width - 4));

  let overlayHeight = 3;
  if (state.loading) {
    overlayHeight = 3;
  } else if (state.files.length > 0) {
    const resultCount = state.files.length;
    const maxListRows = Math.max(1, height - 7);
    const listRows = Math.min(Math.max(1, resultCount), maxListRows);
    overlayHeight = Math.max(0, Math.min(listRows + 3, height - 4));
  }

  const overlayX = Math.floor((width - overlayWidth) / 2);
  const desiredCommandY = Math.floor(height * 0.15);
  const desired = Math.max(0, desiredCommandY - 1);
  const maxY = Math.max(0, height - overlayHeight);
  const overlayY = Math.min(desired, maxY);
  return { x: overlayX, y: overlayY, width: overlayWidth, height: overlayHeight };
}
