import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { UpdateError } from '../../effect/errors';
import type { UpdateIO, GitHubRelease } from './types';
import { findReleaseAsset } from './release';
import { parseReleaseVersion } from './io';

export function parseChecksumFile(content: string, targetFilename: string): string | null {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

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
  const match = digest.match(/^sha256:([a-f0-9]{64})$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export async function computeFileSha256(
  _io: UpdateIO,
  filePath: string
): Promise<string | UpdateError> {
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

export async function verifyReleaseChecksum(
  io: UpdateIO,
  release: GitHubRelease,
  archivePath: string,
  assetName: string
): Promise<void | UpdateError> {
  const assets = release.assets ?? [];

  const asset = assets.find((a) => a.name === assetName);
  let expectedHash = parseGitHubDigest(asset?.digest);

  if (!expectedHash) {
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

function renderManagedWrapper(installDir: string, libExt: 'dylib' | 'so', version: string): string {
  const formattedVersion = `v${version.replace(/^v/, '')}`;
  return `#!/usr/bin/env bash
export ZIG_PTY_LIB="\${ZIG_PTY_LIB:-${installDir}/libzig_pty.${libExt}}"
export ZIG_GIT_LIB="\${ZIG_GIT_LIB:-${installDir}/libzig_git.${libExt}}"
export GHOSTTY_VT_LIB="\${GHOSTTY_VT_LIB:-${installDir}/libghostty-vt.${libExt}}"
export OPENMUX_VERSION="\${OPENMUX_VERSION:-${formattedVersion}}"
export OPENMUX_ORIGINAL_CWD="\${OPENMUX_ORIGINAL_CWD:-\$(pwd)}"
cd "${installDir}"
# Load stdout-rewrite interceptor for transparent backgrounds
# (rewrites sentinel SGR 48;2;13;17;23m to ESC[49m "default background")
if [[ -f "${installDir}/libstdout-rewrite.${libExt}" ]] && [[ -z "\$OPENMUX_NO_REWRITE" ]]; then
  if [[ "\$(uname -s)" == "Darwin" ]]; then
    export DYLD_INSERT_LIBRARIES="\${DYLD_INSERT_LIBRARIES:+\$DYLD_INSERT_LIBRARIES:}${installDir}/libstdout-rewrite.${libExt}"
  else
    export LD_PRELOAD="\${LD_PRELOAD:+\$LD_PRELOAD:}${installDir}/libstdout-rewrite.${libExt}"
  fi
fi
exec "./openmux-bin" "\$@"
`;
}

async function updateManagedWrapper(
  io: UpdateIO,
  wrapperPath: string,
  installDir: string,
  platformInfo: { libExt: 'dylib' | 'so' },
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

export async function installRelease(
  io: UpdateIO,
  release: GitHubRelease,
  installDir: string,
  platformInfo: { target: string; libExt: 'dylib' | 'so' }
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
    // libstdout-rewrite is optional (may not be present in older releases)
    const stdoutRewritePath = path.join(extractedPath, `libstdout-rewrite.${platformInfo.libExt}`);

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

    const stdoutRewriteResult = await io.access(stdoutRewritePath).catch(() => null);
    if (stdoutRewriteResult !== null && !(stdoutRewriteResult instanceof UpdateError)) {
      const rewriteResult = await replaceFileAtomically(
        io,
        stdoutRewritePath,
        path.join(installDir, `libstdout-rewrite.${platformInfo.libExt}`)
      );
      if (rewriteResult instanceof UpdateError) return rewriteResult;
    }

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

export { updateManagedWrapper };
