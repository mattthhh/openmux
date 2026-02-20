import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { afterEach, describe, expect, test, vi } from 'bun:test';
import { detectManagedInstall, findReleaseAsset, getPlatformInfo, runUpdateCommand, selectLatestRelease, type UpdateIO } from '../../src/cli/update';

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
  await fs.writeFile(wrapperPath, '#!/usr/bin/env bash\nexport OPENMUX_VERSION="${OPENMUX_VERSION:-v0.0.0}"\n');
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

    const stable = selectLatestRelease(releases, false);
    const any = selectLatestRelease(releases, true);

    expect(stable?.tag_name).toBe('v1.2.0');
    expect(any?.tag_name).toBe('v1.3.0-beta.1');
  });

  test('finds release asset by exact target', () => {
    const release = {
      tag_name: 'v1.0.0',
      assets: [
        { name: 'openmux-v1.0.0-linux-x64.tar.gz', browser_download_url: 'https://example.com/linux' },
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
      createIoForInstall(install, {
        stdinIsTTY: false,
        fetch: vi.fn().mockResolvedValue(
          jsonResponse({
            tag_name: 'v1.1.0',
            draft: false,
            prerelease: false,
            assets: [{ name: 'openmux-v1.1.0-linux-x64.tar.gz', browser_download_url: 'https://example.com/asset' }],
          })
        ),
      }, [], errors)
    );

    expect(result.exitCode).toBe(2);
    expect(errors[0]).toContain('Re-run with --yes');
  });

  test('reports already up to date', async () => {
    const install = await makeManagedInstall('1.1.0');
    cleanupRoots.push(install.rootDir);

    const logs: string[] = [];
    const result = await runUpdateCommand(
      { kind: 'update', yes: true, prerelease: false },
      createIoForInstall(install, {
        fetch: vi.fn().mockResolvedValue(
          jsonResponse({
            tag_name: 'v1.1.0',
            draft: false,
            prerelease: false,
            assets: [{ name: 'openmux-v1.1.0-linux-x64.tar.gz', browser_download_url: 'https://example.com/asset' }],
          })
        ),
      }, logs)
    );

    expect(result.exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Already up to date'))).toBe(true);
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
          assets: [{ name: 'openmux-v1.2.0-linux-x64.tar.gz', browser_download_url: 'https://example.com/asset' }],
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
    await expect(fs.readFile(path.join(install.installDir, '.version'), 'utf8')).resolves.toBe('1.2.0');
    await expect(fs.readFile(path.join(install.installDir, 'openmux-bin'), 'utf8')).resolves.toBe('new-bin');
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
});
