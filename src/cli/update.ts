import { UpdateError } from '../effect/errors';

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import crypto from 'node:crypto';

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
  digest?: string;
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

type PackageManager = 'npm' | 'bun' | null;

type PackageManagerInstall = {
  type: PackageManager;
  updateCommand: string;
};

type ManagedInstall = {
  binDir: string;
  wrapperPath: string;
  installDir: string;
  currentVersion: string;
};

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ReadFileFn = (filePath: string) => Promise<string | UpdateError>;
type WriteFileFn = (filePath: string, data: string | Uint8Array) => Promise<void | UpdateError>;
type CopyFileFn = (source: string, destination: string) => Promise<void | UpdateError>;
type ChmodFn = (targetPath: string, mode: number) => Promise<void | UpdateError>;
type RenameFn = (source: string, destination: string) => Promise<void | UpdateError>;
type MkdirFn = (dirPath: string) => Promise<void | UpdateError>;
type MkdtempFn = (prefix: string) => Promise<string | UpdateError>;
type RmFn = (targetPath: string) => Promise<void | UpdateError>;
type AccessFn = (targetPath: string) => Promise<void | UpdateError>;
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

function createDefaultUpdateIO(): UpdateIO | UpdateError {
  const fetchFn = globalThis.fetch?.bind(globalThis);
  if (!fetchFn) {
    return new UpdateError({
      operation: 'init',
      reason: 'Fetch API is not available in this runtime',
    });
  }

  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    stdinIsTTY: process.stdin.isTTY === true,
    fetch: fetchFn,
    readFile: (filePath) =>
      fs
        .readFile(filePath, 'utf8')
        .catch((e) => new UpdateError({ operation: 'readFile', reason: String(e), cause: e })),
    writeFile: (filePath, data) =>
      fs
        .writeFile(filePath, data)
        .catch((e) => new UpdateError({ operation: 'writeFile', reason: String(e), cause: e })),
    copyFile: (source, destination) =>
      fs
        .copyFile(source, destination)
        .catch((e) => new UpdateError({ operation: 'copyFile', reason: String(e), cause: e })),
    chmod: (targetPath, mode) =>
      fs
        .chmod(targetPath, mode)
        .catch((e) => new UpdateError({ operation: 'chmod', reason: String(e), cause: e })),
    rename: (source, destination) =>
      fs
        .rename(source, destination)
        .catch((e) => new UpdateError({ operation: 'rename', reason: String(e), cause: e })),
    mkdir: (dirPath) =>
      fs
        .mkdir(dirPath, { recursive: true })
        .then(() => undefined)
        .catch((e) => new UpdateError({ operation: 'mkdir', reason: String(e), cause: e })),
    mkdtemp: (prefix) =>
      fs
        .mkdtemp(prefix)
        .catch((e) => new UpdateError({ operation: 'mkdtemp', reason: String(e), cause: e })),
    rm: (targetPath) =>
      fs
        .rm(targetPath, { recursive: true, force: true })
        .catch((e) => new UpdateError({ operation: 'rm', reason: String(e), cause: e })),
    access: (targetPath) =>
      fs
        .access(targetPath)
        .catch((e) => new UpdateError({ operation: 'access', reason: String(e), cause: e })),
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

export function selectLatestRelease(
  releases: GitHubRelease[],
  options: { includePrerelease: boolean }
): GitHubRelease | null {
  const { includePrerelease } = options;
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

export function findReleaseAsset(
  release: GitHubRelease,
  target: string
): { name: string; url: string } | null {
  const assets = release.assets ?? [];
  const exactName = `openmux-${release.tag_name}-${target}.tar.gz`;

  const exact = assets.find((asset) => asset.name === exactName && asset.browser_download_url);
  if (exact?.name && exact.browser_download_url) {
    return { name: exact.name, url: exact.browser_download_url };
  }

  const fallback = assets.find(
    (asset) => asset.name?.endsWith(`-${target}.tar.gz`) && asset.browser_download_url
  );
  if (!fallback?.name || !fallback.browser_download_url) return null;
  return { name: fallback.name, url: fallback.browser_download_url };
}

async function fetchGitHubJson<T>(io: UpdateIO, url: string): Promise<T | UpdateError> {
  const response = await io
    .fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openmux-update',
      },
    })
    .catch((e) => new UpdateError({ operation: 'fetch', reason: String(e), cause: e }));
  if (response instanceof UpdateError) return response;

  if (!response.ok) {
    return new UpdateError({
      operation: 'fetch',
      reason: `GitHub API request failed (${response.status})`,
    });
  }

  const data = await (response.json() as Promise<T>).catch(
    (e) =>
      new UpdateError({
        operation: 'fetch',
        reason: `Invalid JSON response: ${String(e)}`,
        cause: e,
      })
  );
  return data;
}

async function fetchTargetRelease(
  io: UpdateIO,
  options: { includePrerelease: boolean }
): Promise<GitHubRelease | UpdateError> {
  const { includePrerelease } = options;
  if (!includePrerelease) {
    const release = await fetchGitHubJson<GitHubRelease>(io, `${GITHUB_API_BASE}/releases/latest`);
    if (release instanceof UpdateError) return release;
    if (!release || !release.tag_name) {
      return new UpdateError({
        operation: 'fetchRelease',
        reason: 'GitHub latest release response is missing tag information',
      });
    }
    return release;
  }

  const releases = await fetchGitHubJson<GitHubRelease[]>(
    io,
    `${GITHUB_API_BASE}/releases?per_page=30`
  );
  if (releases instanceof UpdateError) return releases;
  const selected = selectLatestRelease(releases, { includePrerelease: true });
  if (!selected) {
    return new UpdateError({
      operation: 'fetchRelease',
      reason: 'No valid GitHub releases were found',
    });
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

export async function detectManagedInstall(
  io: UpdateIO
): Promise<{ ok: true; value: ManagedInstall } | { ok: false; error: string }> {
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
      error:
        'This install is not managed by openmux update. Use your package manager or installer to update.',
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
  const readResult = await io.readFile(versionPath);
  if (readResult instanceof UpdateError) {
    return {
      ok: false,
      error: `Missing version metadata at ${versionPath}. Reinstall openmux with the official installer.`,
    };
  }
  currentVersion = normalizeVersion(readResult);

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

function fileExists(targetPath: string): boolean {
  try {
    fsSync.accessSync(targetPath, fsSync.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function detectPackageManagerFromPath(env: NodeJS.ProcessEnv): PackageManagerInstall | null {
  const pathValue = env.PATH ?? '';
  if (!pathValue) return null;

  const entries = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
  for (const entry of entries) {
    const normalizedEntry = path.resolve(entry);

    // Ignore project-local node_modules/.bin entries. We only care about global installs.
    if (normalizedEntry.includes(`${path.sep}node_modules${path.sep}.bin`)) {
      continue;
    }

    const wrapperPath = path.join(entry, 'openmux');
    if (!fileExists(wrapperPath)) {
      continue;
    }

    let resolvedWrapperPath = wrapperPath;
    try {
      resolvedWrapperPath = fsSync.realpathSync(wrapperPath);
    } catch {
      // Keep original wrapper path.
    }

    const candidates = [path.resolve(wrapperPath), path.resolve(resolvedWrapperPath)];

    if (
      candidates.some(
        (candidate) =>
          candidate.includes(`${path.sep}.bun${path.sep}`) || candidate.includes('bun/install')
      )
    ) {
      return { type: 'bun', updateCommand: 'bun update -g openmux' };
    }

    if (
      candidates.some(
        (candidate) =>
          candidate.includes(`${path.sep}node_modules${path.sep}openmux${path.sep}`) ||
          candidate.includes(`${path.sep}.npm${path.sep}`)
      )
    ) {
      return { type: 'npm', updateCommand: 'npm update -g openmux' };
    }

    if (path.basename(normalizedEntry) === 'bin') {
      const npmPackagePath = path.join(
        path.dirname(normalizedEntry),
        'lib',
        'node_modules',
        'openmux',
        'package.json'
      );
      if (fileExists(npmPackagePath)) {
        return { type: 'npm', updateCommand: 'npm update -g openmux' };
      }
    }
  }

  return null;
}

function detectPackageManager(
  execPath: string,
  env: NodeJS.ProcessEnv
): PackageManagerInstall | null {
  if (execPath.includes(`${path.sep}.bun${path.sep}`) || execPath.includes('bun/install')) {
    return { type: 'bun', updateCommand: 'bun update -g openmux' };
  }

  if (
    execPath.includes(`${path.sep}node_modules${path.sep}`) ||
    execPath.includes(`${path.sep}.npm${path.sep}`) ||
    execPath.includes('/usr/local/lib/node_modules') ||
    execPath.includes('/usr/lib/node_modules')
  ) {
    return { type: 'npm', updateCommand: 'npm update -g openmux' };
  }

  const managedDir = getManagedInstallDir(env);
  if (managedDir && path.resolve(path.dirname(execPath)) === path.resolve(managedDir)) {
    const home = env.HOME ?? env.USERPROFILE ?? '';
    if (home) {
      const bunGlobalBin = path.join(home, '.bun', 'bin', 'openmux');
      if (fileExists(bunGlobalBin)) {
        return { type: 'bun', updateCommand: 'bun update -g openmux' };
      }

      const npmGlobalPrefix = path.join(home, '.npm-global');
      const npmGlobalWrapper = path.join(npmGlobalPrefix, 'bin', 'openmux');
      const npmGlobalPackage = path.join(
        npmGlobalPrefix,
        'lib',
        'node_modules',
        'openmux',
        'package.json'
      );
      if (fileExists(npmGlobalWrapper) && fileExists(npmGlobalPackage)) {
        return { type: 'npm', updateCommand: 'npm update -g openmux' };
      }
    }

    const fromPath = detectPackageManagerFromPath(env);
    if (fromPath) {
      return fromPath;
    }
  }

  return null;
}

function suggestPackageManagerUpdate(io: UpdateIO, pmInstall: PackageManagerInstall): void {
  io.log(`openmux is installed via ${pmInstall.type}.`);
  io.log(`To update, run: ${pmInstall.updateCommand}`);
}

async function downloadReleaseAsset(
  io: UpdateIO,
  url: string,
  destination: string
): Promise<void | UpdateError> {
  const response = await io
    .fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'openmux-update',
      },
    })
    .catch((e) => new UpdateError({ operation: 'download', reason: String(e), cause: e }));
  if (response instanceof UpdateError) return response;

  if (!response.ok) {
    return new UpdateError({
      operation: 'download',
      reason: `Failed to download release asset (${response.status})`,
    });
  }

  const payload = await response.arrayBuffer().catch(
    (e) =>
      new UpdateError({
        operation: 'download',
        reason: `Failed to read response: ${String(e)}`,
        cause: e,
      })
  );
  if (payload instanceof UpdateError) return payload;

  const writeResult = await io.writeFile(destination, new Uint8Array(payload)).catch(
    (e) =>
      new UpdateError({
        operation: 'download',
        reason: `Failed to write file: ${String(e)}`,
        cause: e,
      })
  );
  if (writeResult instanceof UpdateError) return writeResult;
}

export async function computeFileSha256(
  _io: UpdateIO,
  filePath: string
): Promise<string | UpdateError> {
  // Read file as binary buffer, not UTF-8 text
  const data = await fs.readFile(filePath).catch(
    (e) =>
      new UpdateError({
        operation: 'checksum',
        reason: `Failed to read file: ${String(e)}`,
        cause: e,
      })
  );
  if (data instanceof UpdateError) return data;

  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return hash;
}

export function parseChecksumFile(content: string, targetFilename: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Format: <hash> <filename> or <hash>  <filename> (GNU coreutils style)
    const match = trimmed.match(/^([a-f0-9]{64})\s+\*?(\S+)$/i);
    if (match) {
      const [, hash, filename] = match;
      if (filename === targetFilename || path.basename(filename) === targetFilename) {
        return hash.toLowerCase();
      }
    }
  }
  return null;
}

function parseGitHubDigest(digest: string | undefined): string | null {
  if (!digest) return null;
  // GitHub returns digest in format "sha256:<hash>"
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function verifyReleaseChecksum(
  io: UpdateIO,
  release: GitHubRelease,
  archivePath: string,
  assetName: string
): Promise<void | UpdateError> {
  const assets = release.assets ?? [];

  // Find the asset to get its digest from GitHub API
  const asset = assets.find((a) => a.name === assetName);
  let expectedHash = parseGitHubDigest(asset?.digest);

  if (!expectedHash) {
    // Fallback to SHA256SUMS file for older releases without digest
    io.log('Note: Using legacy SHA256SUMS file for verification.');

    const checksumAsset = assets.find(
      (a) =>
        a.name?.match(/^(SHA256SUMS|sha256sums\.txt|checksums\.txt|sha256\.txt)$/i) &&
        a.browser_download_url
    );

    if (!checksumAsset?.browser_download_url) {
      io.log('Warning: No checksum available for verification.');
      return;
    }

    const checksumResponse = await io
      .fetch(checksumAsset.browser_download_url, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'openmux-update',
        },
      })
      .catch((e) => new UpdateError({ operation: 'verify', reason: String(e), cause: e }));
    if (checksumResponse instanceof UpdateError) return checksumResponse;

    if (!checksumResponse.ok) {
      return new UpdateError({
        operation: 'verify',
        reason: `Failed to download checksum file (${checksumResponse.status})`,
      });
    }

    const checksumContent = await checksumResponse.text().catch(
      (e) =>
        new UpdateError({
          operation: 'verify',
          reason: `Failed to read checksum: ${String(e)}`,
          cause: e,
        })
    );
    if (checksumContent instanceof UpdateError) return checksumContent;

    expectedHash = parseChecksumFile(checksumContent, assetName);

    if (!expectedHash) {
      return new UpdateError({
        operation: 'verify',
        reason: `Could not find checksum for ${assetName} in checksum file`,
      });
    }
  }

  const actualHash = await computeFileSha256(io, archivePath);
  if (actualHash instanceof UpdateError) return actualHash;

  if (actualHash !== expectedHash) {
    return new UpdateError({
      operation: 'verify',
      reason: `Checksum verification failed for ${assetName}. Expected: ${expectedHash}, Actual: ${actualHash}`,
    });
  }
}

async function ensureFileExists(io: UpdateIO, filePath: string): Promise<void | UpdateError> {
  const result = await io.access(filePath).catch(
    () =>
      new UpdateError({
        operation: 'verify',
        reason: `Update archive is missing required file: ${path.basename(filePath)}`,
      })
  );
  if (result instanceof UpdateError) return result;
}

async function replaceFileAtomically(
  io: UpdateIO,
  source: string,
  destination: string,
  options?: { executable?: boolean }
): Promise<void | UpdateError> {
  const tempDestination = `${destination}.new-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const copyResult = await io.copyFile(source, tempDestination).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to copy file: ${String(e)}`,
        cause: e,
      })
  );
  if (copyResult instanceof UpdateError) {
    await io.rm(tempDestination).catch((e) => {
      console.warn('[update] Failed to clean up temp file after copy failure:', e);
    });
    return copyResult;
  }

  if (options?.executable) {
    const chmodResult = await io.chmod(tempDestination, 0o755).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to set permissions: ${String(e)}`,
          cause: e,
        })
    );
    if (chmodResult instanceof UpdateError) {
      await io.rm(tempDestination).catch((e) => {
        console.warn('[update] Failed to clean up temp file after chmod failure:', e);
      });
      return chmodResult;
    }
  }

  const renameResult = await io.rename(tempDestination, destination).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to move file: ${String(e)}`,
        cause: e,
      })
  );
  if (renameResult instanceof UpdateError) {
    await io.rm(tempDestination).catch((e) => {
      console.warn('[update] Failed to clean up temp file after rename failure:', e);
    });
    return renameResult;
  }
}

async function installRelease(
  io: UpdateIO,
  release: GitHubRelease,
  installDir: string,
  platformInfo: PlatformInfo
): Promise<string | UpdateError> {
  const tagName = release.tag_name;
  if (!tagName) {
    return new UpdateError({ operation: 'install', reason: 'Selected release has no tag name' });
  }

  const version = parseReleaseVersion(tagName);
  if (!version) {
    return new UpdateError({
      operation: 'install',
      reason: `Selected release tag is not a valid semver: ${tagName}`,
    });
  }

  const asset = findReleaseAsset(release, platformInfo.target);
  if (!asset) {
    return new UpdateError({
      operation: 'install',
      reason: `No release asset found for target ${platformInfo.target}`,
    });
  }

  const tempRoot = await io.mkdtemp(path.join(io.tmpdir(), 'openmux-update-')).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to create temp directory: ${String(e)}`,
        cause: e,
      })
  );
  if (tempRoot instanceof UpdateError) return tempRoot;

  try {
    const archivePath = path.join(tempRoot, 'openmux.tar.gz');
    const extractedPath = path.join(tempRoot, 'extracted');

    const mkdirResult = await io.mkdir(extractedPath).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to create extract directory: ${String(e)}`,
          cause: e,
        })
    );
    if (mkdirResult instanceof UpdateError) return mkdirResult;

    const downloadResult = await downloadReleaseAsset(io, asset.url, archivePath);
    if (downloadResult instanceof UpdateError) return downloadResult;

    const verifyResult = await verifyReleaseChecksum(io, release, archivePath, asset.name);
    if (verifyResult instanceof UpdateError) return verifyResult;

    const extractResult = await io.extractTarGz(archivePath, extractedPath).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to extract archive: ${String(e)}`,
          cause: e,
        })
    );
    if (extractResult instanceof UpdateError) return extractResult;

    const requiredFiles = [
      'openmux-bin',
      `libzig_pty.${platformInfo.libExt}`,
      `libzig_git.${platformInfo.libExt}`,
      `libghostty-vt.${platformInfo.libExt}`,
    ];

    for (const requiredFile of requiredFiles) {
      const existsResult = await ensureFileExists(io, path.join(extractedPath, requiredFile));
      if (existsResult instanceof UpdateError) return existsResult;
    }

    const installDirResult = await io.mkdir(installDir).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to create install directory: ${String(e)}`,
          cause: e,
        })
    );
    if (installDirResult instanceof UpdateError) return installDirResult;

    const binResult = await replaceFileAtomically(
      io,
      path.join(extractedPath, 'openmux-bin'),
      path.join(installDir, 'openmux-bin'),
      { executable: true }
    );
    if (binResult instanceof UpdateError) return binResult;

    const ptyResult = await replaceFileAtomically(
      io,
      path.join(extractedPath, `libzig_pty.${platformInfo.libExt}`),
      path.join(installDir, `libzig_pty.${platformInfo.libExt}`)
    );
    if (ptyResult instanceof UpdateError) return ptyResult;

    const gitResult = await replaceFileAtomically(
      io,
      path.join(extractedPath, `libzig_git.${platformInfo.libExt}`),
      path.join(installDir, `libzig_git.${platformInfo.libExt}`)
    );
    if (gitResult instanceof UpdateError) return gitResult;

    const vtResult = await replaceFileAtomically(
      io,
      path.join(extractedPath, `libghostty-vt.${platformInfo.libExt}`),
      path.join(installDir, `libghostty-vt.${platformInfo.libExt}`)
    );
    if (vtResult instanceof UpdateError) return vtResult;

    const bunfigPath = path.join(extractedPath, 'bunfig.toml');
    const bunfigResult = await io.access(bunfigPath).catch((e) => {
      console.debug('[update] bunfig.toml not found or not accessible:', e);
      return null;
    });
    if (bunfigResult === null) {
      // Optional: older artifacts may not include bunfig.toml.
    } else {
      const replaceResult = await replaceFileAtomically(
        io,
        bunfigPath,
        path.join(installDir, 'bunfig.toml')
      );
      if (replaceResult instanceof UpdateError) return replaceResult;
    }

    const versionWriteResult = await io.writeFile(path.join(installDir, '.version'), version).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to write version file: ${String(e)}`,
          cause: e,
        })
    );
    if (versionWriteResult instanceof UpdateError) return versionWriteResult;

    return version;
  } finally {
    await io.rm(tempRoot).catch((e) => {
      console.warn('[update] Failed to clean up temp root:', e);
    });
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

async function replaceTextFileAtomically(
  io: UpdateIO,
  destination: string,
  content: string,
  options?: { executable?: boolean }
): Promise<void | UpdateError> {
  const tempDestination = `${destination}.new-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  const writeResult = await io.writeFile(tempDestination, content).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to write wrapper: ${String(e)}`,
        cause: e,
      })
  );
  if (writeResult instanceof UpdateError) {
    await io.rm(tempDestination).catch((e) => {
      console.warn('[update] Failed to clean up temp file after write failure:', e);
    });
    return writeResult;
  }

  if (options?.executable) {
    const chmodResult = await io.chmod(tempDestination, 0o755).catch(
      (e) =>
        new UpdateError({
          operation: 'install',
          reason: `Failed to set wrapper permissions: ${String(e)}`,
          cause: e,
        })
    );
    if (chmodResult instanceof UpdateError) {
      await io.rm(tempDestination).catch((e) => {
        console.warn('[update] Failed to clean up temp file after chmod failure:', e);
      });
      return chmodResult;
    }
  }

  const renameResult = await io.rename(tempDestination, destination).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to move wrapper: ${String(e)}`,
        cause: e,
      })
  );
  if (renameResult instanceof UpdateError) {
    await io.rm(tempDestination).catch((e) => {
      console.warn('[update] Failed to clean up temp file after rename failure:', e);
    });
    return renameResult;
  }
}

async function updateManagedWrapper(
  io: UpdateIO,
  wrapperPath: string,
  installDir: string,
  platformInfo: PlatformInfo,
  version: string
): Promise<void | UpdateError> {
  const mkdirResult = await io.mkdir(path.dirname(wrapperPath)).catch(
    (e) =>
      new UpdateError({
        operation: 'install',
        reason: `Failed to create bin directory: ${String(e)}`,
        cause: e,
      })
  );
  if (mkdirResult instanceof UpdateError) return mkdirResult;

  const content = renderManagedWrapper(installDir, platformInfo.libExt, version);
  const replaceResult = await replaceTextFileAtomically(io, wrapperPath, content, {
    executable: true,
  });
  if (replaceResult instanceof UpdateError) return replaceResult;
}

function isAffirmative(answer: string | null): boolean {
  if (!answer) return false;
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

function toCliOutcome(exitCode: number): CliOutcome {
  return { kind: 'handled', exitCode };
}

export async function runUpdateCommand(
  command: UpdateCommand,
  overrides: Partial<UpdateIO> = {}
): Promise<CliOutcome> {
  const ioResult = createDefaultUpdateIO();
  if (ioResult instanceof UpdateError) {
    console.error(`Update init failed: ${ioResult.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }
  const io = { ...ioResult, ...overrides };

  // Check if installed via package manager (npm/bun) first
  const pmInstall = detectPackageManager(io.execPath, io.env);
  if (pmInstall) {
    suggestPackageManagerUpdate(io, pmInstall);
    return toCliOutcome(EXIT_SUCCESS);
  }

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

  const release = await fetchTargetRelease(io, {
    includePrerelease: command.prerelease,
  });
  if (release instanceof UpdateError) {
    io.error(`Failed to fetch release: ${release.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

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
      io.error(
        'openmux update requires confirmation in an interactive terminal. Re-run with --yes.'
      );
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
  const installedVersion = await installRelease(
    io,
    release,
    install.value.installDir,
    platformInfo
  );
  if (installedVersion instanceof UpdateError) {
    io.error(`Update failed: ${installedVersion.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const wrapperResult = await updateManagedWrapper(
    io,
    install.value.wrapperPath,
    install.value.installDir,
    platformInfo,
    installedVersion
  );
  if (wrapperResult instanceof UpdateError) {
    io.error(`Update failed: ${wrapperResult.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  io.log(
    `Updated openmux ${formatVersion(install.value.currentVersion)} -> ${formatVersion(installedVersion)}.`
  );
  return toCliOutcome(EXIT_SUCCESS);
}
