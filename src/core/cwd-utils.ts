import fs from 'node:fs';

/**
 * Repair persisted cwd values that accidentally captured a trailing prompt artifact.
 *
 * The zsh shell hook regression appended a literal `%` to reported paths. Keep real
 * directories ending in `%` intact by only trimming when the original path does not
 * exist and the trimmed path does.
 */
export function repairLikelyTrailingPercentCwd(cwd: string): string {
  if (!cwd.endsWith('%')) return cwd;

  const trimmed = cwd.slice(0, -1);
  if (!trimmed) return cwd;
  if (fs.existsSync(cwd)) return cwd;
  if (!fs.existsSync(trimmed)) return cwd;

  return trimmed;
}
