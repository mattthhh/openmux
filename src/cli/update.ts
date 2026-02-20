import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

import { compareSemver } from '../core/update-check';

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 6;
const REPO = 'monotykamary/openmux';
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO}`;

type UpdateCommand = {
  kind: 'update';
  yes: boolean;
  prerelease: boolean;
};

type CliOutcome = { kind: 'handled'; exitCode: number };

type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAsset[];
};

type PlatformInfo = {
  target: string;
  libExt: 'dylib' | 'so';
};

type ManagedInstall = {
  binDir: string;
  wrapperPath: string;
  installDir: string;
  currentVersion: string;
};

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ReadFileFn = (filePath: string) => Promise<string>;
type WriteFileFn = (filePath: string, data: string | Uint8Array) => Promise<void>;
type CopyFileFn = (source: string, destination: string) => Promise<void>;
type ChmodFn = (targetPath: string, mode: number) => Promise<void>;
type RenameFn = (source: string, destination: string) => Promise<void>;
type MkdirFn = (dirPath: string) => Promise<void>;
type MkdtempFn = (prefix: string) => Promise<string>;
type RmFn = (targetPath: string) => Promise<void>;
type AccessFn = (targetPath: string) => Promise<void>;
type PromptFn = (message: string) => Promise<string | null>;
type TarExtractFn = (archivePath: string, destination: string) => Promise<void>;

export type UpdateIO = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  execPath: string;
  stdinIsTTY: boolean;
  fetch: FetchFn;
  readFile: ReadFileFn;
  writeFile: WriteFileFn;
  copyFile: CopyFileFn;
  chmod: ChmodFn;
  rename: RenameFn;
  mkdir: MkdirFn;
  mkdtemp: MkdtempFn;
  rm: RmFn;
  access: AccessFn;
  tmpdir: () => string;
  prompt: PromptFn;
  extractTarGz: TarExtractFn;
  log: (message: string) => void;
  error: (message: string) => void;
};

function defaultPrompt(message: string): Promise<string | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return rl
    .question(message)
    .then((answer) => answer)
    .finally(() => {
      rl.close();
    });
}

function defaultExtractTarGz(archivePath: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', destination], {
      stdio: 'ignore',
    });
    child.on('error', (error) => reject(error));
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to extract update archive (tar exit ${code ?? 'unknown'}).`));
    });
  });
}

function createDefaultUpdateIO(): UpdateIO {
  const fetchFn = globalThis.fetch?.bind(globalThis);
  if (!fetchFn) {
    throw new Error('Fetch API is not available in this runtime.');
  }

  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    stdinIsTTY: process.stdin.isTTY === true,
    fetch: fetchFn,
    readFile: (filePath) => fs.readFile(filePath, 'utf8'),
    writeFile: (filePath, data) => fs.writeFile(filePath, data),
    copyFile: (source, destination) => fs.copyFile(source, destination),
    chmod: (targetPath, mode) => fs.chmod(targetPath, mode),
    rename: (source, destination) => fs.rename(source, destination),
    mkdir: (dirPath) => fs.mkdir(dirPath, { recursive: true }).then(() => undefined),
    mkdtemp: (prefix) => fs.mkdtemp(prefix),
    rm: (targetPath) => fs.rm(targetPath, { recursive: true, force: true }),
    access: (targetPath) => fs.access(targetPath),
    tmpdir: () => os.tmpdir(),
    prompt: defaultPrompt,
    extractTarGz: defaultExtractTarGz,
    log: (message) => console.log(message),
    error: (message) => console.error(message),
  };
}

function formatVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '');
}

function parseReleaseVersion(tagName: string | undefined): string | null {
  if (!tagName) return null;
  const normalized = normalizeVersion(tagName);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function getPlatformInfo(platform: NodeJS.Platform, arch: string): PlatformInfo | null {
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return { target: 'darwin-arm64', libExt: 'dylib' };
    }
    if (arch === 'x64') {
      return { target: 'darwin-x64', libExt: 'dylib' };
    }
    return null;
  }
  if (platform === 'linux') {
    if (arch === 'x64') {
      return { target: 'linux-x64', libExt: 'so' };
    }
    if (arch === 'arm64') {
      return { target: 'linux-arm64', libExt: 'so' };
    }
    return null;
  }
  return null;
}

export function selectLatestRelease(releases: GitHubRelease[], includePrerelease: boolean): GitHubRelease | null {
  const candidates = releases.filter((release) => {
    if (release.draft) return false;
    if (!includePrerelease && release.prerelease) return false;
    return parseReleaseVersion(release.tag_name) !== null;
  });

  let best: GitHubRelease | null = null;
  let bestVersion: string | null = null;

  for (const release of candidates) {
    const version = parseReleaseVersion(release.tag_name);
    if (!version) continue;
    if (!bestVersion || compareSemver(bestVersion, version) < 0) {
      best = release;
      bestVersion = version;
    }
  }

  return best;
}

export function findReleaseAsset(release: GitHubRelease, target: string): { name: string; url: string } | null {
  const assets = release.assets ?? [];
  const exactName = `openmux-${release.tag_name}-${target}.tar.gz`;

  const exact = assets.find((asset) => asset.name === exactName && asset.browser_download_url);
  if (exact?.name && exact.browser_download_url) {
    return { name: exact.name, url: exact.browser_download_url };
  }

  const fallback = assets.find((asset) => asset.name?.endsWith(`-${target}.tar.gz`) && asset.browser_download_url);
  if (!fallback?.name || !fallback.browser_download_url) return null;
  return { name: fallback.name, url: fallback.browser_download_url };
}

async function fetchGitHubJson<T>(io: UpdateIO, url: string): Promise<T> {
  const response = await io.fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'openmux-update',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

async function fetchTargetRelease(io: UpdateIO, includePrerelease: boolean): Promise<GitHubRelease> {
  if (!includePrerelease) {
    const release = await fetchGitHubJson<GitHubRelease>(io, `${GITHUB_API_BASE}/releases/latest`);
    if (!release || !release.tag_name) {
      throw new Error('GitHub latest release response is missing tag information.');
    }
    return release;
  }

  const releases = await fetchGitHubJson<GitHubRelease[]>(io, `${GITHUB_API_BASE}/releases?per_page=30`);
  const selected = selectLatestRelease(releases, true);
  if (!selected) {
    throw new Error('No valid GitHub releases were found.');
  }
  return selected;
}

function getManagedInstallDir(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  if (!home) return null;
  const dataHome = env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return path.join(dataHome, 'openmux');
}

function getManagedBinDir(env: NodeJS.ProcessEnv): string | null {
  const home = env.HOME ?? env.USERPROFILE ?? '';
  if (!home) return null;
  return env.XDG_BIN_HOME ?? path.join(home, '.local', 'bin');
}

export async function detectManagedInstall(io: UpdateIO): Promise<{ ok: true; value: ManagedInstall } | { ok: false; error: string }> {
  const managedDir = getManagedInstallDir(io.env);
  if (!managedDir) {
    return { ok: false, error: 'Could not determine managed install directory (HOME is not set).' };
  }
  const binDir = getManagedBinDir(io.env);
  if (!binDir) {
    return { ok: false, error: 'Could not determine managed bin directory (HOME is not set).' };
  }

  const execDir = path.dirname(io.execPath);
  const execName = path.basename(io.execPath);
  if (execName !== 'openmux-bin' && execName !== 'openmux-bin.exe') {
    return {
      ok: false,
      error: 'This install is not managed by openmux update. Use your package manager or installer to update.',
    };
  }

  if (path.resolve(execDir) !== path.resolve(managedDir)) {
    return {
      ok: false,
      error: `Managed install expected at ${managedDir}, but running binary from ${execDir}.`,
    };
  }

  const versionPath = path.join(managedDir, '.version');
  let currentVersion: string;
  try {
    currentVersion = normalizeVersion(await io.readFile(versionPath));
  } catch {
    return {
      ok: false,
      error: `Missing version metadata at ${versionPath}. Reinstall openmux with the official installer.`,
    };
  }

  if (!currentVersion) {
    return {
      ok: false,
      error: `Version metadata at ${versionPath} is empty. Reinstall openmux with the official installer.`,
    };
  }

  return {
    ok: true,
    value: {
      binDir,
      wrapperPath: path.join(binDir, 'openmux'),
      installDir: managedDir,
      currentVersion,
    },
  };
}

async function downloadReleaseAsset(io: UpdateIO, url: string, destination: string): Promise<void> {
  const response = await io.fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'openmux-update',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download release asset (${response.status}).`);
  }

  const payload = new Uint8Array(await response.arrayBuffer());
  await io.writeFile(destination, payload);
}

async function ensureFileExists(io: UpdateIO, filePath: string): Promise<void> {
  try {
    await io.access(filePath);
  } catch {
    throw new Error(`Update archive is missing required file: ${path.basename(filePath)}`);
  }
}

async function replaceFileAtomically(
  io: UpdateIO,
  source: string,
  destination: string,
  options?: { executable?: boolean }
): Promise<void> {
  const tempDestination = `${destination}.new-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  try {
    await io.copyFile(source, tempDestination);
    if (options?.executable) {
      await io.chmod(tempDestination, 0o755);
    }
    await io.rename(tempDestination, destination);
  } catch (error) {
    await io.rm(tempDestination).catch(() => undefined);
    throw error;
  }
}

async function installRelease(io: UpdateIO, release: GitHubRelease, installDir: string, platformInfo: PlatformInfo): Promise<string> {
  const tagName = release.tag_name;
  if (!tagName) {
    throw new Error('Selected release has no tag name.');
  }

  const version = parseReleaseVersion(tagName);
  if (!version) {
    throw new Error(`Selected release tag is not a valid semver: ${tagName}`);
  }

  const asset = findReleaseAsset(release, platformInfo.target);
  if (!asset) {
    throw new Error(`No release asset found for target ${platformInfo.target}.`);
  }

  const tempRoot = await io.mkdtemp(path.join(io.tmpdir(), 'openmux-update-'));
  try {
    const archivePath = path.join(tempRoot, 'openmux.tar.gz');
    const extractedPath = path.join(tempRoot, 'extracted');

    await io.mkdir(extractedPath);
    await downloadReleaseAsset(io, asset.url, archivePath);
    await io.extractTarGz(archivePath, extractedPath);

    const requiredFiles = [
      'openmux-bin',
      `libzig_pty.${platformInfo.libExt}`,
      `libzig_git.${platformInfo.libExt}`,
      `libghostty-vt.${platformInfo.libExt}`,
    ];

    for (const requiredFile of requiredFiles) {
      await ensureFileExists(io, path.join(extractedPath, requiredFile));
    }

    await io.mkdir(installDir);

    await replaceFileAtomically(io, path.join(extractedPath, 'openmux-bin'), path.join(installDir, 'openmux-bin'), {
      executable: true,
    });
    await replaceFileAtomically(
      io,
      path.join(extractedPath, `libzig_pty.${platformInfo.libExt}`),
      path.join(installDir, `libzig_pty.${platformInfo.libExt}`)
    );
    await replaceFileAtomically(
      io,
      path.join(extractedPath, `libzig_git.${platformInfo.libExt}`),
      path.join(installDir, `libzig_git.${platformInfo.libExt}`)
    );
    await replaceFileAtomically(
      io,
      path.join(extractedPath, `libghostty-vt.${platformInfo.libExt}`),
      path.join(installDir, `libghostty-vt.${platformInfo.libExt}`)
    );

    const bunfigPath = path.join(extractedPath, 'bunfig.toml');
    try {
      await io.access(bunfigPath);
      await replaceFileAtomically(io, bunfigPath, path.join(installDir, 'bunfig.toml'));
    } catch {
      // Optional: older artifacts may not include bunfig.toml.
    }

    await io.writeFile(path.join(installDir, '.version'), version);
    return version;
  } finally {
    await io.rm(tempRoot).catch(() => undefined);
  }
}

function renderManagedWrapper(installDir: string, libExt: 'dylib' | 'so', version: string): string {
  const formattedVersion = formatVersion(version);
  return `#!/usr/bin/env bash
export ZIG_PTY_LIB="\${ZIG_PTY_LIB:-${installDir}/libzig_pty.${libExt}}"
export ZIG_GIT_LIB="\${ZIG_GIT_LIB:-${installDir}/libzig_git.${libExt}}"
export GHOSTTY_VT_LIB="\${GHOSTTY_VT_LIB:-${installDir}/libghostty-vt.${libExt}}"
export OPENMUX_VERSION="\${OPENMUX_VERSION:-${formattedVersion}}"
export OPENMUX_ORIGINAL_CWD="\${OPENMUX_ORIGINAL_CWD:-\$(pwd)}"
cd "${installDir}"
exec "./openmux-bin" "\$@"
`;
}

async function replaceTextFileAtomically(io: UpdateIO, destination: string, content: string, options?: { executable?: boolean }): Promise<void> {
  const tempDestination = `${destination}.new-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  try {
    await io.writeFile(tempDestination, content);
    if (options?.executable) {
      await io.chmod(tempDestination, 0o755);
    }
    await io.rename(tempDestination, destination);
  } catch (error) {
    await io.rm(tempDestination).catch(() => undefined);
    throw error;
  }
}

async function updateManagedWrapper(io: UpdateIO, wrapperPath: string, installDir: string, platformInfo: PlatformInfo, version: string): Promise<void> {
  await io.mkdir(path.dirname(wrapperPath));
  const content = renderManagedWrapper(installDir, platformInfo.libExt, version);
  await replaceTextFileAtomically(io, wrapperPath, content, { executable: true });
}

function isAffirmative(answer: string | null): boolean {
  if (!answer) return false;
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

function toCliOutcome(exitCode: number): CliOutcome {
  return { kind: 'handled', exitCode };
}

export async function runUpdateCommand(command: UpdateCommand, overrides: Partial<UpdateIO> = {}): Promise<CliOutcome> {
  const io = {
    ...createDefaultUpdateIO(),
    ...overrides,
  };

  const platformInfo = getPlatformInfo(io.platform, io.arch);
  if (!platformInfo) {
    io.error(`Unsupported platform for updates: ${io.platform}/${io.arch}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const install = await detectManagedInstall(io);
  if (!install.ok) {
    io.error(install.error);
    return toCliOutcome(EXIT_INTERNAL);
  }

  try {
    const release = await fetchTargetRelease(io, command.prerelease);
    const latestVersion = parseReleaseVersion(release.tag_name);
    if (!latestVersion) {
      io.error(`Latest release tag is not a valid semver: ${release.tag_name ?? '<missing>'}`);
      return toCliOutcome(EXIT_INTERNAL);
    }

    if (compareSemver(install.value.currentVersion, latestVersion) >= 0) {
      io.log(`Already up to date (${formatVersion(install.value.currentVersion)}).`);
      return toCliOutcome(EXIT_SUCCESS);
    }

    if (!command.yes) {
      if (!io.stdinIsTTY) {
        io.error('openmux update requires confirmation in an interactive terminal. Re-run with --yes.');
        return toCliOutcome(EXIT_USAGE);
      }

      const answer = await io.prompt(
        `Update openmux ${formatVersion(install.value.currentVersion)} -> ${formatVersion(latestVersion)}? [y/N] `
      );
      if (!isAffirmative(answer)) {
        io.log('Update cancelled.');
        return toCliOutcome(EXIT_SUCCESS);
      }
    }

    io.log(`Downloading ${formatVersion(latestVersion)} for ${platformInfo.target}...`);
    const installedVersion = await installRelease(io, release, install.value.installDir, platformInfo);
    await updateManagedWrapper(io, install.value.wrapperPath, install.value.installDir, platformInfo, installedVersion);
    io.log(`Updated openmux ${formatVersion(install.value.currentVersion)} -> ${formatVersion(installedVersion)}.`);
    return toCliOutcome(EXIT_SUCCESS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(`Update failed: ${message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }
}
