import type { CommandPaletteCommand } from '../core/command-palette';

export function filterCommands(
  commands: CommandPaletteCommand[],
  query: string
): CommandPaletteCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return commands.filter((command) => {
    const haystack = [
      command.title,
      command.description ?? '',
      command.action,
      ...(command.keywords ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
