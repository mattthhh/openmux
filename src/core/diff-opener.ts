import { execFile } from 'node:child_process';
import * as errore from 'errore';

export class DiffDiscoveryError extends errore.createTaggedError({
  name: 'DiffDiscoveryError',
  message: 'Diff discovery failed: $reason',
}) {}

export type DiffTargetType = 'unstaged' | 'staged' | 'unpushed' | 'branch';

export interface DiffTarget {
  /** Display label */
  label: string;
  /** The type of diff target */
  type: DiffTargetType;
  /** Arguments to git diff (empty string for unstaged, "--cached" for staged, "@{u}...HEAD" for unpushed, branch name for branch) */
  diffArgs: string;
  /** Optional file count hint */
  fileCount?: number;
  /** Whether this is a separator entry (renders as a divider line) */
  isSeparator: boolean;
}

function execFileAsync(
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options?.cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

async function getChangedFileCount(cwd: string, diffArgs: string): Promise<number> {
  const fullArgs = ['diff', ...diffArgs.split(/\s+/).filter(Boolean), '--name-only'];
  const result = await errore.tryAsync<string, DiffDiscoveryError>({
    try: () => execFileAsync('git', fullArgs, { cwd }),
    catch: () => new DiffDiscoveryError({ reason: 'failed to count changed files' }),
  });

  if (result instanceof DiffDiscoveryError) return 0;
  return result.trim().split('\n').filter(Boolean).length;
}

async function getLocalBranches(cwd: string): Promise<string[]> {
  const result = await errore.tryAsync<string, DiffDiscoveryError>({
    try: () => execFileAsync('git', ['branch', '--list'], { cwd }),
    catch: () => new DiffDiscoveryError({ reason: 'failed to list branches' }),
  });

  if (result instanceof DiffDiscoveryError) return [];

  return result
    .split('\n')
    .map((line) => line.replace(/^\*?\s+/, ''))
    .filter(Boolean);
}

function sortBranches(branches: string[]): string[] {
  const priority = ['main', 'master'];
  const prioritized = priority
    .filter((p) => branches.includes(p))
    .map((p) => branches.splice(branches.indexOf(p), 1)[0]!);
  return [...prioritized, ...branches.sort()];
}

export async function discoverDiffTargets(rootDir: string): Promise<DiffTarget[]> {
  const targets: DiffTarget[] = [];

  // Fire all independent queries in parallel
  const [unstagedResult, stagedResult, unpushedResult, branches] = await Promise.all([
    getChangedFileCount(rootDir, ''),
    getChangedFileCount(rootDir, '--cached'),
    getChangedFileCount(rootDir, '@{u}...HEAD'),
    getLocalBranches(rootDir),
  ]);

  targets.push({
    label: 'Unstaged changes',
    type: 'unstaged',
    diffArgs: '',
    fileCount: unstagedResult,
    isSeparator: false,
  });

  targets.push({
    label: 'Staged changes',
    type: 'staged',
    diffArgs: '--cached',
    fileCount: stagedResult,
    isSeparator: false,
  });

  targets.push({
    label: 'Commits not pushed',
    type: 'unpushed',
    diffArgs: '@{u}...HEAD',
    fileCount: unpushedResult,
    isSeparator: false,
  });

  // Branch comparison — fire all counts in parallel
  if (branches.length > 0) {
    targets.push({
      label: '',
      type: 'branch',
      diffArgs: '',
      isSeparator: true,
    });

    const sorted = sortBranches(branches);
    const counts = await Promise.all(sorted.map((b) => getChangedFileCount(rootDir, b)));

    for (let i = 0; i < sorted.length; i++) {
      targets.push({
        label: sorted[i]!,
        type: 'branch',
        diffArgs: sorted[i]!,
        fileCount: counts[i],
        isSeparator: false,
      });
    }
  }

  return targets;
}

/** Build the diff command string from the configured template and target */
export function buildDiffCommand(
  commandTemplate: string,
  target: DiffTarget,
  options?: { autoExit?: boolean }
): string {
  let command = commandTemplate.replace(/\$DIFF_ARGS/g, target.diffArgs);
  if (options?.autoExit) {
    command += '; exit';
  }
  return command;
}
