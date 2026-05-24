import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { afterEach, describe, expect, test, vi } from 'bun:test';
import { UpdateError } from '../../src/effect/errors';
import {
  detectManagedInstall,
  findReleaseAsset,
  getPlatformInfo,
  runUpdateCommand,
  selectLatestRelease,
  computeFileSha256,
  parseChecksumFile,
  verifyReleaseChecksum,
  type UpdateIO,
} from '../../src/cli/update';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function makeManagedInstall(version: string): Promise<{
  rootDir: string;
  dataHome: string;
  binHome: string;
  installDir: string;
  execPath: string;
  wrapperPath: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-update-test-'));
  const dataHome = path.join(rootDir, 'data');
  const binHome = path.join(rootDir, 'bin');
  const installDir = path.join(dataHome, 'openmux');
  const execPath = path.join(installDir, 'openmux-bin');
  const wrapperPath = path.join(binHome, 'openmux');

  await fs.mkdir(installDir, { recursive: true });
  await fs.mkdir(binHome, { recursive: true });
  await fs.writeFile(path.join(installDir, '.version'), version);
  await fs.writeFile(execPath, 'old-bin');
  await fs.writeFile(path.join(installDir, 'libzig_pty.so'), 'old-pty');
  await fs.writeFile(path.join(installDir, 'libzig_git.so'), 'old-git');
  await fs.writeFile(path.join(installDir, 'libghostty-vt.so'), 'old-ghostty');
  await fs.writeFile(
    wrapperPath,
    '#!/usr/bin/env bash\nexport OPENMUX_VERSION="${OPENMUX_VERSION:-v0.0.0}"\n'
  );
  await fs.chmod(wrapperPath, 0o755);

  return { rootDir, dataHome, binHome, installDir, execPath, wrapperPath };
}

function createIoForInstall(
  install: { dataHome: string; binHome: string; installDir: string; execPath: string },
  overrides: Partial<UpdateIO> = {},
  logs: string[] = [],
  errors: string[] = []
): Partial<UpdateIO> {
  return {
    env: { HOME: install.dataHome, XDG_DATA_HOME: install.dataHome, XDG_BIN_HOME: install.binHome },
    platform: 'linux',
    arch: 'x64',
    execPath: install.execPath,
    stdinIsTTY: true,
    log: (message: string) => logs.push(message),
    error: (message: string) => errors.push(message),
    ...overrides,
  };
}

describe('cli update', () => {
  const cleanupRoots: string[] = [];

  afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('maps supported platform targets', () => {
    expect(getPlatformInfo('linux', 'x64')).toEqual({ target: 'linux-x64', libExt: 'so' });
    expect(getPlatformInfo('darwin', 'arm64')).toEqual({ target: 'darwin-arm64', libExt: 'dylib' });
    expect(getPlatformInfo('linux', 'ppc64')).toBeNull();
  });

  test('selects newest release with prereleases when requested', () => {
    const releases = [
      { tag_name: 'v1.2.0', draft: false, prerelease: false },
      { tag_name: 'v1.3.0-beta.1', draft: false, prerelease: true },
      { tag_name: 'v1.1.9', draft: false, prerelease: false },
    ];

    const stable = selectLatestRelease(releases, { includePrerelease: false });
    const any = selectLatestRelease(releases, { includePrerelease: true });

    expect(stable?.tag_name).toBe('v1.2.0');
    expect(any?.tag_name).toBe('v1.3.0-beta.1');
  });

  test('finds release asset by exact target', () => {
    const release = {
      tag_name: 'v1.0.0',
      assets: [
        {
          name: 'openmux-v1.0.0-linux-x64.tar.gz',
          browser_download_url: 'https://example.com/linux',
        },
      ],
    };

    expect(findReleaseAsset(release, 'linux-x64')).toEqual({
      name: 'openmux-v1.0.0-linux-x64.tar.gz',
      url: 'https://example.com/linux',
    });
  });

  test('fails in non-interactive mode without --yes', async () => {
    const install = await makeManagedInstall('1.0.0');
    cleanupRoots.push(install.rootDir);

    const errors: string[] = [];
    const result = await runUpdateCommand(
      { kind: 'update', yes: false, prerelease: false },
      createIoForInstall(
        install,
        {
          stdinIsTTY: false,
          fetch: vi.fn().mockResolvedValue(
            jsonResponse({
              tag_name: 'v1.1.0',
              draft: false,
              prerelease: false,
              assets: [
                {
                  name: 'openmux-v1.1.0-linux-x64.tar.gz',
                  browser_download_url: 'https://example.com/asset',
                },
              ],
            })
          ),
        },
        [],
        errors
      )
    );

    expect(result.exitCode).toBe(2);
    expect(errors[0]).toContain('Re-run with --yes');
  });

  test('reports already up to date', async () => {
    const install = await makeManagedInstall('1.1.0');
    cleanupRoots.push(install.rootDir);

    // Write a wrapper that includes the interceptor sentinel so
    // isWrapperStale returns false and we hit the early return.
    await fs.writeFile(
      install.wrapperPath,
      '#!/usr/bin/env bash\nexport LD_PRELOAD="$LIB_DIR/libstdout-rewrite.so"\nexec "./openmux-bin" "$@"\n'
    );

    const logs: string[] = [];
    const result = await runUpdateCommand(
      { kind: 'update', yes: true, prerelease: false },
      createIoForInstall(
        install,
        {
          fetch: vi.fn().mockResolvedValue(
            jsonResponse({
              tag_name: 'v1.1.0',
              draft: false,
              prerelease: false,
              assets: [
                {
                  name: 'openmux-v1.1.0-linux-x64.tar.gz',
                  browser_download_url: 'https://example.com/asset',
                },
              ],
            })
          ),
        },
        logs
      )
    );

    expect(result.exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Already up to date'))).toBe(true);
  });

  test('repairs stale wrapper when already up to date', async () => {
    const install = await makeManagedInstall('1.1.0');
    cleanupRoots.push(install.rootDir);

    const fetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.1.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'openmux-v1.1.0-linux-x64.tar.gz',
              browser_download_url: 'https://example.com/asset',
            },
          ],
        });
      }
      if (url === 'https://example.com/asset') {
        return new Response('archive-bytes', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const logs: string[] = [];
    const result = await runUpdateCommand(
      { kind: 'update', yes: true, prerelease: false },
      createIoForInstall(
        install,
        {
          fetch,
          extractTarGz: async (_archivePath, destination) => {
            await fs.writeFile(path.join(destination, 'openmux-bin'), 'new-bin');
            await fs.writeFile(path.join(destination, 'libzig_pty.so'), 'new-pty');
            await fs.writeFile(path.join(destination, 'libzig_git.so'), 'new-git');
            await fs.writeFile(path.join(destination, 'libghostty-vt.so'), 'new-ghostty');
            await fs.writeFile(path.join(destination, 'bunfig.toml'), '# bunfig');
          },
        },
        logs
      )
    );

    expect(result.exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Repairing stale wrapper'))).toBe(true);
    const wrapper = await fs.readFile(install.wrapperPath, 'utf8');
    expect(wrapper).toContain('LD_PRELOAD');
  });

  test('downloads and installs newer release with --yes', async () => {
    const install = await makeManagedInstall('1.0.0');
    cleanupRoots.push(install.rootDir);

    const fetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/releases/latest')) {
        return jsonResponse({
          tag_name: 'v1.2.0',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'openmux-v1.2.0-linux-x64.tar.gz',
              browser_download_url: 'https://example.com/asset',
            },
          ],
        });
      }
      if (url === 'https://example.com/asset') {
        return new Response('archive-bytes', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    const result = await runUpdateCommand(
      { kind: 'update', yes: true, prerelease: false },
      createIoForInstall(install, {
        fetch,
        extractTarGz: async (_archivePath, destination) => {
          await fs.writeFile(path.join(destination, 'openmux-bin'), 'new-bin');
          await fs.writeFile(path.join(destination, 'libzig_pty.so'), 'new-pty');
          await fs.writeFile(path.join(destination, 'libzig_git.so'), 'new-git');
          await fs.writeFile(path.join(destination, 'libghostty-vt.so'), 'new-ghostty');
          await fs.writeFile(path.join(destination, 'bunfig.toml'), '# bunfig');
        },
      })
    );

    expect(result.exitCode).toBe(0);
    await expect(fs.readFile(path.join(install.installDir, '.version'), 'utf8')).resolves.toBe(
      '1.2.0'
    );
    await expect(fs.readFile(path.join(install.installDir, 'openmux-bin'), 'utf8')).resolves.toBe(
      'new-bin'
    );
    const wrapper = await fs.readFile(install.wrapperPath, 'utf8');
    expect(wrapper).toContain('OPENMUX_VERSION="${OPENMUX_VERSION:-v1.2.0}"');
    expect(wrapper).toContain(`cd "${install.installDir}"`);
  });

  test('rejects unsupported install layout', async () => {
    const install = await makeManagedInstall('1.0.0');
    cleanupRoots.push(install.rootDir);

    const detected = await detectManagedInstall({
      env: { HOME: install.dataHome, XDG_DATA_HOME: install.dataHome },
      platform: 'linux',
      arch: 'x64',
      execPath: '/tmp/openmux-bin',
      stdinIsTTY: true,
      fetch: vi.fn() as any,
      readFile: async (filePath) => fs.readFile(filePath, 'utf8'),
      writeFile: async (filePath, data) => fs.writeFile(filePath, data),
      copyFile: async (source, destination) => fs.copyFile(source, destination),
      chmod: async (targetPath, mode) => fs.chmod(targetPath, mode),
      rename: async (source, destination) => fs.rename(source, destination),
      mkdir: async (dirPath) => {
        await fs.mkdir(dirPath, { recursive: true });
      },
      mkdtemp: async (prefix) => fs.mkdtemp(prefix),
      rm: async (targetPath) => {
        await fs.rm(targetPath, { recursive: true, force: true });
      },
      access: async (targetPath) => fs.access(targetPath),
      tmpdir: () => os.tmpdir(),
      prompt: async () => null,
      extractTarGz: async () => undefined,
      log: () => undefined,
      error: () => undefined,
    });

    expect(detected.ok).toBe(false);
  });

  describe('checksum verification', () => {
    test('computes SHA256 hash of file', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'));
      cleanupRoots.push(tempDir);

      const testFile = path.join(tempDir, 'test.txt');
      const content = 'hello world';
      await fs.writeFile(testFile, content);

      const io: Partial<UpdateIO> = {
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
      };

      const hash = await computeFileSha256(io as UpdateIO, testFile);
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      expect(hash).toBe(expectedHash);
    });

    test('parses checksum file with standard format', () => {
      const checksums = `
a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 openmux-v1.0.0-linux-x64.tar.gz
# This is a comment
b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3  openmux-v1.0.0-darwin-arm64.tar.gz
`;

      const result = parseChecksumFile(checksums, 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    });

    test('parses checksum file with binary marker', () => {
      const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 *openmux-v1.0.0-linux-x64.tar.gz`;

      const result = parseChecksumFile(checksums, 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    });

    test('parses checksum with path in filename', () => {
      const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 ./dist/openmux-v1.0.0-linux-x64.tar.gz`;

      const result = parseChecksumFile(checksums, 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    });

    test('returns null when checksum not found', () => {
      const checksums = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 other-file.tar.gz`;

      const result = parseChecksumFile(checksums, 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBeNull();
    });

    test('returns null for empty checksum file', () => {
      const result = parseChecksumFile('', 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBeNull();
    });

    test('returns null for comments-only checksum file', () => {
      const checksums = `# This is a comment\n# Another comment`;
      const result = parseChecksumFile(checksums, 'openmux-v1.0.0-linux-x64.tar.gz');
      expect(result).toBeNull();
    });

    test('verifies checksum using GitHub API digest field', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-digest-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      const content = 'fake archive content';
      await fs.writeFile(archivePath, content);
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        log: (message) => logs.push(message),
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [
          {
            name: 'openmux-v1.0.0-linux-x64.tar.gz',
            browser_download_url: 'https://example.com/asset',
            digest: `sha256:${expectedHash}`,
          },
        ],
      };

      await verifyReleaseChecksum(
        io as UpdateIO,
        release,
        archivePath,
        'openmux-v1.0.0-linux-x64.tar.gz'
      );
      // Should not log about using legacy SHA256SUMS
      expect(logs.some((line) => line.includes('legacy'))).toBe(false);
    });

    test('verifies checksum successfully', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-verify-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      const content = 'fake archive content';
      await fs.writeFile(archivePath, content);
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      const checksumsContent = `${expectedHash} openmux-v1.0.0-linux-x64.tar.gz`;

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
        log: (message) => logs.push(message),
        fetch: vi.fn().mockResolvedValue(
          new Response(checksumsContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [{ name: 'SHA256SUMS', browser_download_url: 'https://example.com/checksums' }],
      };

      await expect(
        verifyReleaseChecksum(
          io as UpdateIO,
          release,
          archivePath,
          'openmux-v1.0.0-linux-x64.tar.gz'
        )
      ).resolves.toBeUndefined();
    });

    test('returns error on checksum mismatch', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-mismatch-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      const content = 'fake archive content';
      await fs.writeFile(archivePath, content);
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');

      // Wrong hash in checksums file
      const wrongHash = '0000000000000000000000000000000000000000000000000000000000000000';
      const checksumsContent = `${wrongHash} openmux-v1.0.0-linux-x64.tar.gz`;

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
        log: (message) => logs.push(message),
        fetch: vi.fn().mockResolvedValue(
          new Response(checksumsContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [{ name: 'SHA256SUMS', browser_download_url: 'https://example.com/checksums' }],
      };

      const result = await verifyReleaseChecksum(
        io as UpdateIO,
        release,
        archivePath,
        'openmux-v1.0.0-linux-x64.tar.gz'
      );

      expect(result instanceof UpdateError).toBe(true);
      if (result instanceof UpdateError) {
        expect(result.message).toContain('Checksum verification failed');
      }
    });

    test('warns when no checksum file available', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-missing-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      await fs.writeFile(archivePath, 'content');

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        log: (message) => logs.push(message),
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [
          {
            name: 'openmux-v1.0.0-linux-x64.tar.gz',
            browser_download_url: 'https://example.com/asset',
          },
        ],
      };

      await verifyReleaseChecksum(
        io as UpdateIO,
        release,
        archivePath,
        'openmux-v1.0.0-linux-x64.tar.gz'
      );

      expect(logs.some((line) => line.includes('Warning: No checksum available'))).toBe(true);
    });

    test('returns error when checksum file download fails', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-download-fail-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      await fs.writeFile(archivePath, 'content');

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        log: (message) => logs.push(message),
        fetch: vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [{ name: 'SHA256SUMS', browser_download_url: 'https://example.com/checksums' }],
      };

      const result = await verifyReleaseChecksum(
        io as UpdateIO,
        release,
        archivePath,
        'openmux-v1.0.0-linux-x64.tar.gz'
      );

      expect(result instanceof UpdateError).toBe(true);
      if (result instanceof UpdateError) {
        expect(result.message).toContain('Failed to download checksum file');
      }
    });

    test('returns error when checksum entry not found in file', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-entry-missing-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      await fs.writeFile(archivePath, 'content');

      // Checksums file doesn't contain our file
      const checksumsContent = `a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 other-file.tar.gz`;

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        log: (message) => logs.push(message),
        fetch: vi.fn().mockResolvedValue(
          new Response(checksumsContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [{ name: 'SHA256SUMS', browser_download_url: 'https://example.com/checksums' }],
      };

      const result = await verifyReleaseChecksum(
        io as UpdateIO,
        release,
        archivePath,
        'openmux-v1.0.0-linux-x64.tar.gz'
      );

      expect(result instanceof UpdateError).toBe(true);
      if (result instanceof UpdateError) {
        expect(result.message).toContain(
          'Could not find checksum for openmux-v1.0.0-linux-x64.tar.gz'
        );
      }
    });

    test('accepts sha256sums.txt as checksum file', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-alt-name-test-'));
      cleanupRoots.push(tempDir);

      const archivePath = path.join(tempDir, 'openmux-v1.0.0-linux-x64.tar.gz');
      const content = 'fake archive content';
      await fs.writeFile(archivePath, content);
      const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

      const checksumsContent = `${expectedHash} openmux-v1.0.0-linux-x64.tar.gz`;

      const logs: string[] = [];
      const io: Partial<UpdateIO> = {
        readFile: (filePath) => fs.readFile(filePath, 'utf8'),
        log: (message) => logs.push(message),
        fetch: vi.fn().mockResolvedValue(
          new Response(checksumsContent, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          })
        ),
      };

      const release = {
        tag_name: 'v1.0.0',
        assets: [{ name: 'sha256sums.txt', browser_download_url: 'https://example.com/checksums' }],
      };

      await expect(
        verifyReleaseChecksum(
          io as UpdateIO,
          release,
          archivePath,
          'openmux-v1.0.0-linux-x64.tar.gz'
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('package manager detection', () => {
    test('detects npm install from node_modules path', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            execPath: '/usr/local/lib/node_modules/openmux/dist/openmux-bin',
            fetch: vi.fn(),
          },
          logs
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('npm'))).toBe(true);
      expect(logs.some((line) => line.includes('npm update -g openmux'))).toBe(true);
    });

    test('detects npm install from .npm path', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            execPath: '/home/user/.npm/_npx/openmux/dist/openmux-bin',
            fetch: vi.fn(),
          },
          logs
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('npm'))).toBe(true);
    });

    test('detects bun install from .bun path', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            execPath: '/home/user/.bun/install/global/openmux/dist/openmux-bin',
            fetch: vi.fn(),
          },
          logs
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('bun'))).toBe(true);
      expect(logs.some((line) => line.includes('bun update -g openmux'))).toBe(true);
    });

    test('detects bun install from ~/.bun/bin wrapper for managed binary', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const bunWrapper = path.join(install.dataHome, '.bun', 'bin', 'openmux');
      await fs.mkdir(path.dirname(bunWrapper), { recursive: true });
      await fs.writeFile(bunWrapper, '#!/usr/bin/env bash\n');

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(install, { fetch: vi.fn() }, logs)
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('bun'))).toBe(true);
      expect(logs.some((line) => line.includes('bun update -g openmux'))).toBe(true);
    });

    test('detects npm global install from PATH wrapper and global package metadata', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const npmPrefix = path.join(install.dataHome, '.npm-global');
      const npmWrapper = path.join(npmPrefix, 'bin', 'openmux');
      const npmPackageJson = path.join(npmPrefix, 'lib', 'node_modules', 'openmux', 'package.json');

      await fs.mkdir(path.dirname(npmWrapper), { recursive: true });
      await fs.mkdir(path.dirname(npmPackageJson), { recursive: true });
      await fs.writeFile(npmWrapper, '#!/usr/bin/env bash\n');
      await fs.writeFile(npmPackageJson, '{"name":"openmux"}');

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            env: {
              HOME: install.dataHome,
              XDG_DATA_HOME: install.dataHome,
              XDG_BIN_HOME: install.binHome,
              PATH: `${path.join(npmPrefix, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
            },
            fetch: vi.fn(),
          },
          logs
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('npm'))).toBe(true);
      expect(logs.some((line) => line.includes('npm update -g openmux'))).toBe(true);
    });

    test('does not detect npm from nearby package-lock.json files', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      await fs.writeFile(path.join(install.dataHome, 'package-lock.json'), '{}');

      const logs: string[] = [];
      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            fetch: vi.fn().mockResolvedValue(
              jsonResponse({
                tag_name: 'v1.0.0',
                draft: false,
                prerelease: false,
                assets: [],
              })
            ),
          },
          logs
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('installed via npm'))).toBe(false);
      expect(logs.some((line) => line.includes('Already up to date'))).toBe(true);
    });

    test('falls back to managed install when no package manager detected', async () => {
      const install = await makeManagedInstall('1.0.0');
      cleanupRoots.push(install.rootDir);

      const logs: string[] = [];
      const errors: string[] = [];

      const fetch = vi.fn(async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        if (url.endsWith('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v1.2.0',
            draft: false,
            prerelease: false,
            assets: [
              {
                name: 'openmux-v1.2.0-linux-x64.tar.gz',
                browser_download_url: 'https://example.com/asset',
              },
            ],
          });
        }
        if (url === 'https://example.com/asset') {
          return new Response('archive-bytes', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      });

      const result = await runUpdateCommand(
        { kind: 'update', yes: true, prerelease: false },
        createIoForInstall(
          install,
          {
            fetch,
            extractTarGz: async (_archivePath, destination) => {
              await fs.writeFile(path.join(destination, 'openmux-bin'), 'new-bin');
              await fs.writeFile(path.join(destination, 'libzig_pty.so'), 'new-pty');
              await fs.writeFile(path.join(destination, 'libzig_git.so'), 'new-git');
              await fs.writeFile(path.join(destination, 'libghostty-vt.so'), 'new-ghostty');
              await fs.writeFile(path.join(destination, 'bunfig.toml'), '# bunfig');
            },
          },
          logs,
          errors
        )
      );

      expect(result.exitCode).toBe(0);
      expect(logs.some((line) => line.includes('Downloading'))).toBe(true);
      expect(logs.some((line) => line.includes('Updated openmux'))).toBe(true);
    });
  });
});
