import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';

const repoRoot = path.resolve(import.meta.dir, '../../..');
const scriptPath = path.join(
  repoRoot,
  'native/zig-ghostty-wrapper/compat/prepare_ghostty_overlay.py'
);

const cleanupRoots: string[] = [];

async function writeFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

describe('prepare_ghostty_overlay.py', () => {
  afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('copies vendor files and overlays replacements into an existing output tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-ghostty-overlay-'));
    cleanupRoots.push(root);

    const vendorSrc = path.join(root, 'vendor-src');
    const overlayDir = path.join(root, 'overlay');
    const outDir = path.join(root, 'out');

    const vendorDirs = ['terminal', 'unicode', 'lib', 'datastruct', 'os', 'simd'];
    for (const dir of vendorDirs) {
      await fs.mkdir(path.join(vendorSrc, dir), { recursive: true });
      await writeFile(path.join(vendorSrc, dir, `${dir}.txt`), `vendor-${dir}`);
    }

    await writeFile(path.join(vendorSrc, 'terminal/main.zig'), 'vendor-main');
    await writeFile(path.join(vendorSrc, 'config/url.zig'), 'vendor-url');
    await writeFile(path.join(vendorSrc, 'fastmem.zig'), 'vendor-fastmem');
    await writeFile(path.join(vendorSrc, 'input/config.zig'), 'vendor-input-config');
    await writeFile(path.join(vendorSrc, 'input/function_keys.zig'), 'vendor-function-keys');
    await writeFile(path.join(vendorSrc, 'input/key.zig'), 'vendor-key');
    await writeFile(path.join(vendorSrc, 'input/key_encode.zig'), 'vendor-key-encode');
    await writeFile(path.join(vendorSrc, 'input/key_mods.zig'), 'vendor-key-mods');
    await writeFile(path.join(vendorSrc, 'input/kitty.zig'), 'vendor-kitty');
    await writeFile(path.join(vendorSrc, 'tripwire.zig'), 'vendor-tripwire');

    await writeFile(path.join(overlayDir, 'ghostty-src/terminal/main.zig'), 'overlay-main');
    await writeFile(path.join(overlayDir, 'ghostty_min.zig'), 'overlay-entrypoint');

    const result = childProcess.spawnSync('python3', [scriptPath, vendorSrc, overlayDir, outDir], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(await fs.readFile(path.join(outDir, 'ghostty-src/terminal/main.zig'), 'utf8')).toBe(
      'overlay-main'
    );
    expect(await fs.readFile(path.join(outDir, 'ghostty-src/unicode/unicode.txt'), 'utf8')).toBe(
      'vendor-unicode'
    );
    expect(await fs.readFile(path.join(outDir, 'ghostty-src/input/key.zig'), 'utf8')).toBe(
      'vendor-key'
    );
    expect(await fs.readFile(path.join(outDir, 'ghostty_min.zig'), 'utf8')).toBe(
      'overlay-entrypoint'
    );
  });
});
