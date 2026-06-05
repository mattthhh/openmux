import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import * as errore from 'errore';
import type { FileOpenerSettings } from './user-config';

export class FileDiscoveryError extends errore.createTaggedError({
  name: 'FileDiscoveryError',
  message: 'File discovery failed: $reason',
}) {}

export interface FileEntry {
  /** Absolute path of the file */
  absolutePath: string;
  /** Path relative to the search root */
  relativePath: string;
  /** Whether this entry is the special "Open folder" action */
  isFolderAction: boolean;
  /** Whether this entry is a directory */
  isDirectory: boolean;
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

async function discoverGitFiles(rootDir: string, maxFiles: number): Promise<FileEntry[]> {
  const result = await errore.tryAsync<string, FileDiscoveryError>({
    try: () => execFileAsync('git', ['ls-files', '-z'], { cwd: rootDir }),
    catch: (e) => new FileDiscoveryError({ reason: `git ls-files failed: ${String(e)}` }),
  });

  if (result instanceof FileDiscoveryError) {
    return [];
  }

  const files = result.split('\0').filter(Boolean).slice(0, maxFiles);

  return files.map((file) => ({
    absolutePath: path.join(rootDir, file),
    relativePath: file,
    isFolderAction: false,
    isDirectory: false,
  }));
}

async function discoverFallbackFiles(rootDir: string, maxFiles: number): Promise<FileEntry[]> {
  const result = await errore.tryAsync<string, FileDiscoveryError>({
    try: () =>
      execFileAsync(
        'find',
        [
          '.',
          '-type',
          'f',
          '-not',
          '-path',
          './.git/*',
          '-not',
          '-path',
          './node_modules/*',
          '-not',
          '-path',
          './.venv/*',
          '-not',
          '-path',
          './__pycache__/*',
          '-print0',
        ],
        { cwd: rootDir }
      ),
    catch: (e) => new FileDiscoveryError({ reason: `find command failed: ${String(e)}` }),
  });

  if (result instanceof FileDiscoveryError) {
    return [];
  }

  const files = result.split('\0').filter(Boolean).slice(0, maxFiles);

  return files.map((file) => ({
    absolutePath: path.join(rootDir, file),
    relativePath: file,
    isFolderAction: false,
    isDirectory: false,
  }));
}

/**
 * Discover files under rootDir, preferring git-tracked files when a repo exists.
 * Prepends a special "Open folder" entry.
 */
export async function discoverFiles(
  rootDir: string,
  settings: FileOpenerSettings
): Promise<FileEntry[]> {
  const gitDir = path.join(rootDir, '.git');
  const isGitRepo = fs.existsSync(gitDir);

  let files: FileEntry[];
  if (isGitRepo) {
    files = await discoverGitFiles(rootDir, settings.maxFiles);
    if (files.length === 0) {
      files = await discoverFallbackFiles(rootDir, settings.maxFiles);
    }
  } else {
    files = await discoverFallbackFiles(rootDir, settings.maxFiles);
  }

  const folderAction: FileEntry = {
    absolutePath: rootDir,
    relativePath: '',
    isFolderAction: true,
    isDirectory: true,
  };

  return [folderAction, ...files];
}

/** Open a directory in the system file manager */
export async function openInFileManager(dirPath: string): Promise<void> {
  const platform = process.platform;
  const result = await errore.tryAsync<void, FileDiscoveryError>({
    try: async () => {
      if (platform === 'darwin') {
        await execFileAsync('open', [dirPath]);
      } else if (platform === 'linux') {
        await execFileAsync('xdg-open', [dirPath]);
      } else {
        // Windows fallback
        await execFileAsync('explorer', [dirPath]);
      }
    },
    catch: (e) => new FileDiscoveryError({ reason: `Failed to open file manager: ${String(e)}` }),
  });

  if (result instanceof FileDiscoveryError) {
    console.warn('[file-opener]', result.message);
  }
}

/** Build the editor command arguments to open a specific file */
export function buildEditorCommand(
  settings: FileOpenerSettings,
  filePath: string,
  options?: { autoExit?: boolean }
): { args: string[]; autoExit: boolean } {
  const args = [...settings.editorArgs, filePath];
  return { args, autoExit: options?.autoExit ?? settings.autoExit };
}
