/**
 * Template overlay summary helpers.
 */

import type { Workspaces } from '../../core/operations/layout-actions';
import type {
  TemplateSession,
  TemplateLayoutNode,
  TemplateWorkspaceLayout,
} from '../../effect/models';
import { collectPanes } from '../../core/layout-tree';
import { pathTail } from './formatting';

export type SaveSummaryLine =
  | { type: 'text'; value: string }
  | { type: 'pane'; prefix: string; label: string; cwdTail: string; hasProcess: boolean };

export type TemplateSummary = {
  workspaceCount: number;
  paneCount: number;
  workspaces: Array<{
    id: number;
    layoutMode: string;
    panes: Array<{ id: string; ptyId?: string }>;
  }>;
};

export function buildTemplateSummary(workspaces: Workspaces): TemplateSummary {
  const summaries: TemplateSummary['workspaces'] = [];

  const entries = Object.entries(workspaces)
    .map(([idStr, workspace]) => ({ id: Number(idStr), workspace }))
    .filter(({ workspace }) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0))
    .sort((a, b) => a.id - b.id);

  for (const entry of entries) {
    const workspace = entry.workspace!;
    const panes: Array<{ id: string; ptyId?: string }> = [];
    if (workspace.mainPane) {
      for (const pane of collectPanes(workspace.mainPane)) {
        panes.push({ id: pane.id, ptyId: pane.ptyId });
      }
    }
    for (const pane of workspace.stackPanes) {
      for (const leaf of collectPanes(pane)) {
        panes.push({ id: leaf.id, ptyId: leaf.ptyId });
      }
    }
    summaries.push({
      id: entry.id,
      layoutMode: workspace.layoutMode,
      panes,
    });
  }

  const totalPanes = summaries.reduce((count, ws) => count + ws.panes.length, 0);
  return {
    workspaceCount: summaries.length,
    paneCount: totalPanes,
    workspaces: summaries,
  };
}

export function buildSaveSummaryLines(params: {
  summary: TemplateSummary;
  paneCwds: Map<string, string>;
  paneProcesses: Map<string, string>;
  fallbackCwd: string;
}): SaveSummaryLine[] {
  const lines: SaveSummaryLine[] = [];

  if (params.summary.workspaceCount === 0) {
    lines.push({ type: 'text', value: 'No panes to save' });
    return lines;
  }

  params.summary.workspaces.forEach((workspace, workspaceIndex) => {
    const paneCount = workspace.panes.length;
    const isLastWorkspace = workspaceIndex === params.summary.workspaces.length - 1;
    const workspacePrefix = isLastWorkspace ? '└─' : '├─';
    const paneIndent = isLastWorkspace ? '   ' : '│  ';

    lines.push({
      type: 'text',
      value: `${workspacePrefix} workspace [${workspace.id}] (${workspace.layoutMode.toUpperCase()})`,
    });

    workspace.panes.forEach((pane, paneIndex) => {
      const cwd = params.paneCwds.get(pane.id) ?? params.fallbackCwd;
      const processName = params.paneProcesses.get(pane.id);
      const isLastPane = paneIndex === paneCount - 1;
      const panePrefix = isLastPane ? '└─' : '├─';
      lines.push({
        type: 'pane',
        prefix: `${paneIndent}${panePrefix} `,
        label: processName ?? `pane ${paneIndex + 1}`,
        cwdTail: pathTail(cwd),
        hasProcess: Boolean(processName),
      });
    });
  });

  return lines;
}

function countTemplateLayoutNode(node: TemplateLayoutNode | null): number {
  if (!node) return 0;
  if (node.type === 'split') {
    return countTemplateLayoutNode(node.first) + countTemplateLayoutNode(node.second);
  }
  return 1;
}

function countTemplateLayout(layout: TemplateWorkspaceLayout | undefined): number {
  if (!layout) return 0;
  let total = countTemplateLayoutNode(layout.main);
  for (const node of layout.stack) {
    total += countTemplateLayoutNode(node);
  }
  return total;
}

export function getTemplateStats(template: TemplateSession): {
  workspaceCount: number;
  paneCount: number;
} {
  if (template.workspaces.length > 0) {
    let paneCount = 0;
    for (const workspace of template.workspaces) {
      const layoutCount = countTemplateLayout(workspace.layout);
      if (layoutCount > 0) {
        paneCount += layoutCount;
      } else if (workspace.panes?.length) {
        paneCount += workspace.panes.length;
      } else {
        paneCount += template.defaults.paneCount;
      }
    }
    return {
      workspaceCount: template.workspaces.length,
      paneCount,
    };
  }

  return {
    workspaceCount: template.defaults.workspaceCount,
    paneCount: template.defaults.workspaceCount * template.defaults.paneCount,
  };
}
