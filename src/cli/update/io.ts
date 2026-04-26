import { UpdateError } from '../../effect/errors';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import type { UpdateIO } from './types';

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

export function createDefaultUpdateIO(): UpdateIO | UpdateError {
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

export function formatVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/, '');
}

export function parseReleaseVersion(tagName: string | undefined): string | null {
  if (!tagName) return null;
  const normalized = normalizeVersion(tagName);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    return null;
  }
  return normalized;
}
