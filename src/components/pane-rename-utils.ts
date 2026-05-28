export const DEFAULT_PANE_TITLE = 'shell';

export type PaneRenameResult = { type: 'clear'; title: string } | { type: 'manual'; title: string };

export function resolvePaneRename(
  value: string,
  defaultTitle: string = DEFAULT_PANE_TITLE
): PaneRenameResult {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { type: 'clear', title: defaultTitle };
  }
  return { type: 'manual', title: trimmed };
}
