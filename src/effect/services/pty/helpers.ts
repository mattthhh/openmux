/**
 * Helper functions for PTY service (errore version)
 * Git-related utilities backed by libgit2.
 */

import { watch } from 'fs';
import * as errore from 'errore';
import {
  getRepoStatusAsync,
  getDiffStatsAsync,
  type GitDiffStats as NativeGitDiffStats,
  type GitRepoState,
} from '../../../../native/zig-git/ts/index';

/** Git watcher setup error - kept for future use
class GitWatcherError extends errore.createTaggedError({
  name: "GitWatcherError",
  message: "Git watcher setup failed for $gitDir: $reason",
}) {}
*/

/** Git info fetch error */
class GitInfoError extends errore.createTaggedError({
  name: 'GitInfoError',
  message: 'Git info fetch failed for $cwd: $reason',
}) {}

export interface GitInfo {
  branch: string | undefined;
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  ahead: number | undefined;
  behind: number | undefined;
  stashCount: number | undefined;
  state: GitRepoState | undefined;
  detached: boolean;
  repoKey: string;
  diffStats?: GitDiffStats;
}

/**
 * Git diff statistics (lines added and removed)
 */
export interface GitDiffStats {
  added: number;
  removed: number;
  binary: number;
}

export interface GitRepoChangeEvent {
  repoKey: string;
  gitDir: string;
  workDir: string | null;
}

interface RepoEntry {
  key: string;
  gitDir: string;
  workDir: string | null;
  branch: string | undefined;
  dirty: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  ahead: number | undefined;
  behind: number | undefined;
  stashCount: number | undefined;
  state: GitRepoState | undefined;
  detached: boolean;
  stale: boolean;
  lastFetched: number;
  lastAccess: number;
  lastStaleAt?: number;
  diffStats?: GitDiffStats;
  diffInFlight?: Promise<GitDiffStats | undefined>;
  infoInFlight?: Promise<RepoEntry | null>;
  gitWatcher?: ReturnType<typeof watch>;
  workWatcher?: ReturnType<typeof watch>;
}

const repoCache = new Map<string, RepoEntry>();
const cwdToRepoKey = new Map<string, string>();
const pendingByCwd = new Map<string, Promise<RepoEntry | null>>();
const gitRepoChangeSubscribers = new Set<(event: GitRepoChangeEvent) => void>();

const STATUS_TTL_MS = 2000;
const CACHE_TTL_MS = 10 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let isDisposed = false;

function normalizeRepoPath(path: string | null): string | null {
  if (!path) return null;
  if (path.length > 1 && (path.endsWith('/') || path.endsWith('\\'))) {
    return path.slice(0, -1);
  }
  return path;
}

function scheduleCleanup() {
  if (cleanupTimer || isDisposed) return;
  cleanupTimer = setInterval(() => {
    if (isDisposed) return;
    const now = Date.now();
    for (const [key, entry] of repoCache.entries()) {
      if (now - entry.lastAccess > CACHE_TTL_MS) {
        entry.gitWatcher?.close();
        entry.workWatcher?.close();
        repoCache.delete(key);
      }
    }
  }, CACHE_TTL_MS);
  cleanupTimer.unref?.();
}

/**
 * Dispose all git helper resources including timers, caches, and file watchers.
 * This should be called on application shutdown to prevent memory leaks.
 */
export function disposeGitHelpers(): void {
  if (isDisposed) return;
  isDisposed = true;

  // Clear the cleanup timer
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  // Close all file watchers and clear caches
  for (const [, entry] of repoCache) {
    entry.gitWatcher?.close();
    entry.workWatcher?.close();
  }
  repoCache.clear();
  cwdToRepoKey.clear();
  pendingByCwd.clear();
  gitRepoChangeSubscribers.clear();
}

function notifyGitRepoChange(entry: RepoEntry) {
  const event: GitRepoChangeEvent = {
    repoKey: entry.key,
    gitDir: entry.gitDir,
    workDir: entry.workDir,
  };

  for (const subscriber of gitRepoChangeSubscribers) {
    subscriber(event);
  }
}

function markStale(entry: RepoEntry) {
  const now = Date.now();
  if (entry.lastStaleAt && now - entry.lastStaleAt < 50) {
    return;
  }
  entry.lastStaleAt = now;
  entry.stale = true;
  notifyGitRepoChange(entry);
}

function ensureGitWatcher(entry: RepoEntry) {
  if (entry.gitWatcher) return;
  try {
    const recursive = process.platform === 'darwin' || process.platform === 'win32';
    entry.gitWatcher = watch(entry.gitDir, { recursive }, () => {
      markStale(entry);
    });
    entry.gitWatcher.on('error', () => {
      entry.gitWatcher?.close();
      entry.gitWatcher = undefined;
    });
  } catch {
    entry.gitWatcher = undefined;
  }
}

function ensureWorkdirWatcher(entry: RepoEntry) {
  if (!entry.workDir || entry.workWatcher) return;
  try {
    const recursive = process.platform === 'darwin' || process.platform === 'win32';
    entry.workWatcher = watch(entry.workDir, { recursive }, () => {
      markStale(entry);
    });
    entry.workWatcher.on('error', () => {
      entry.workWatcher?.close();
      entry.workWatcher = undefined;
    });
  } catch {
    entry.workWatcher = undefined;
  }
}

async function refreshRepoInfo(cwd: string, existingKey?: string): Promise<RepoEntry | null> {
  const existingEntry = existingKey ? repoCache.get(existingKey) : undefined;
  if (existingEntry?.infoInFlight) {
    return existingEntry.infoInFlight;
  }
  if (!existingEntry) {
    const pending = pendingByCwd.get(cwd);
    if (pending) return pending;
  }

  const refreshPromise = (async () => {
    const info = await getRepoStatusAsync(cwd);
    if (!info || !info.gitDir) {
      if (existingEntry) {
        existingEntry.lastAccess = Date.now();
        return existingEntry;
      }
      if (existingKey) {
        const oldEntry = repoCache.get(existingKey);
        oldEntry?.gitWatcher?.close();
        oldEntry?.workWatcher?.close();
        repoCache.delete(existingKey);
      }
      cwdToRepoKey.delete(cwd);
      return null;
    }

    const gitDir = normalizeRepoPath(info.gitDir);
    if (!gitDir) return null;

    const workDir = normalizeRepoPath(info.workDir);
    const key = workDir ?? gitDir;

    if (existingKey && existingKey !== key) {
      const oldEntry = repoCache.get(existingKey);
      oldEntry?.gitWatcher?.close();
      oldEntry?.workWatcher?.close();
      repoCache.delete(existingKey);
    }

    const now = Date.now();
    let entry = repoCache.get(key);
    const nextState = info.state === 'unknown' ? undefined : info.state;
    const nextAhead = info.ahead ?? undefined;
    const nextBehind = info.behind ?? undefined;
    const nextStash = info.stashCount ?? undefined;

    if (!entry) {
      entry = {
        key,
        gitDir,
        workDir,
        branch: info.branch ?? undefined,
        dirty: info.dirty,
        staged: info.staged,
        unstaged: info.unstaged,
        untracked: info.untracked,
        conflicted: info.conflicted,
        ahead: nextAhead,
        behind: nextBehind,
        stashCount: nextStash,
        state: nextState,
        detached: info.detached,
        stale: false,
        lastFetched: now,
        lastAccess: now,
      };
      repoCache.set(key, entry);
    } else {
      entry.gitDir = gitDir;
      entry.workDir = workDir;
      entry.branch = info.branch ?? undefined;
      entry.dirty = info.dirty;
      entry.staged = info.staged;
      entry.unstaged = info.unstaged;
      entry.untracked = info.untracked;
      entry.conflicted = info.conflicted;
      entry.ahead = nextAhead;
      entry.behind = nextBehind;
      entry.stashCount = nextStash;
      entry.state = nextState;
      entry.detached = info.detached;
      entry.stale = false;
      entry.lastFetched = now;
      entry.lastAccess = now;
    }

    cwdToRepoKey.set(cwd, key);
    ensureGitWatcher(entry);
    ensureWorkdirWatcher(entry);
    scheduleCleanup();
    return entry;
  })();

  if (existingEntry) {
    existingEntry.infoInFlight = refreshPromise;
  } else {
    pendingByCwd.set(cwd, refreshPromise);
  }

  try {
    return await refreshPromise;
  } finally {
    if (existingEntry?.infoInFlight === refreshPromise) {
      existingEntry.infoInFlight = undefined;
    }
    if (!existingEntry) {
      pendingByCwd.delete(cwd);
    }
  }
}

async function getRepoEntry(
  cwd: string,
  options: { force?: boolean; maxAgeMs?: number } = {}
): Promise<RepoEntry | null> {
  const now = Date.now();
  const maxAgeMs = options.maxAgeMs ?? STATUS_TTL_MS;
  const cachedKey = cwdToRepoKey.get(cwd);
  const cached = cachedKey ? repoCache.get(cachedKey) : undefined;

  if (!cached) {
    return refreshRepoInfo(cwd);
  }

  cached.lastAccess = now;
  if (options.force || cached.stale || now - cached.lastFetched > maxAgeMs) {
    return refreshRepoInfo(cwd, cached.key);
  }

  return cached;
}

/**
 * Get git branch + dirty indicator for a directory.
 */
export async function getGitInfo(
  cwd: string,
  options?: { force?: boolean; maxAgeMs?: number; includeDiffStats?: boolean }
): Promise<GitInfo | undefined> {
  const entryResult = await errore.tryAsync<RepoEntry | null, GitInfoError>({
    try: () => getRepoEntry(cwd, options),
    catch: (e) => new GitInfoError({ cwd, reason: String(e), cause: e }),
  });

  if (entryResult instanceof GitInfoError) return undefined;
  if (!entryResult) return undefined;

  const diffStats = options?.includeDiffStats ? await getGitDiffStats(cwd) : undefined;

  return {
    branch: entryResult.branch,
    dirty: entryResult.dirty,
    staged: entryResult.staged,
    unstaged: entryResult.unstaged,
    untracked: entryResult.untracked,
    conflicted: entryResult.conflicted,
    ahead: entryResult.ahead,
    behind: entryResult.behind,
    stashCount: entryResult.stashCount,
    state: entryResult.state,
    detached: entryResult.detached,
    repoKey: entryResult.key,
    diffStats,
  };
}

/**
 * Get git branch for a directory (compat helper).
 */
export async function getGitBranch(cwd: string): Promise<string | undefined> {
  const info = await getGitInfo(cwd);
  return info?.branch;
}

export function subscribeToGitRepoChanges(
  callback: (event: GitRepoChangeEvent) => void
): () => void {
  gitRepoChangeSubscribers.add(callback);
  return () => {
    gitRepoChangeSubscribers.delete(callback);
  };
}

/**
 * Get the git diff statistics for a directory.
 * Includes untracked changes and binary file count.
 */
export async function getGitDiffStats(cwd: string): Promise<GitDiffStats | undefined> {
  const entryResult = await errore.tryAsync<RepoEntry | null, GitInfoError>({
    try: () => getRepoEntry(cwd),
    catch: (e) => new GitInfoError({ cwd, reason: String(e), cause: e }),
  });

  if (entryResult instanceof GitInfoError) return undefined;
  if (!entryResult) return undefined;

  entryResult.lastAccess = Date.now();
  if (entryResult.diffInFlight) return entryResult.diffInFlight;

  entryResult.diffInFlight = getDiffStatsAsync(cwd).then((stats: NativeGitDiffStats | null) => {
    entryResult.diffInFlight = undefined;
    if (!stats || (stats.added === 0 && stats.removed === 0 && stats.binary === 0)) {
      entryResult.diffStats = undefined;
      return undefined;
    }
    entryResult.diffStats = stats;
    return stats;
  });

  return entryResult.diffInFlight;
}
