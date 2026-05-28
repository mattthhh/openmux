/**
 * Smoke tests for scrollback archive module.
 * Basic integration tests ensuring the module works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ScrollbackArchive,
  ScrollbackArchiveManager,
  createChunk,
  findChunk,
  packPlacements,
  unpackPlacements,
  loadMeta,
  flushMeta,
} from '../';

describe('scrollback smoke', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrollback-smoke-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exports all public APIs', () => {
    expect(ScrollbackArchive).toBeDefined();
    expect(ScrollbackArchiveManager).toBeDefined();
    expect(createChunk).toBeDefined();
    expect(findChunk).toBeDefined();
    expect(packPlacements).toBeDefined();
    expect(unpackPlacements).toBeDefined();
    expect(loadMeta).toBeDefined();
    expect(flushMeta).toBeDefined();
  });

  it('basic archive workflow', async () => {
    const archive = new ScrollbackArchive({ rootDir: tempDir });

    // Create simple test lines with different row identifiers
    const lines = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 80 }, (_, i) => ({
        char: String.fromCharCode(65 + ((row + i) % 26)),
        fg: { r: 255, g: 255, b: 255 },
        bg: { r: 0, g: 0, b: 0 },
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1 as const,
      }))
    );

    // Append lines
    await archive.appendLines(lines);
    expect(archive.length).toBe(3);

    // Read back line 1 - should have 'B' as first char (65 + 1 = 66 = 'B')
    const retrieved = archive.getLine(1);
    expect(retrieved).not.toBeNull();
    expect(retrieved![0].char).toBe('B');

    // Cleanup
    archive.dispose();
  });

  it('archive with manager workflow', async () => {
    const manager = new ScrollbackArchiveManager(10 * 1024 * 1024);
    const archive = new ScrollbackArchive({
      rootDir: tempDir,
      manager,
    });

    const line = Array.from({ length: 80 }, () => ({
      char: 'X',
      fg: { r: 200, g: 200, b: 200 },
      bg: { r: 0, g: 0, b: 0 },
      bold: true,
      italic: false,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1 as const,
    }));

    await archive.appendLines([line]);
    expect(manager.getArchiveCount()).toBe(1);

    archive.dispose();
    expect(manager.getArchiveCount()).toBe(0);
  });

  it('persistence round-trip', async () => {
    // Create and populate
    const archive1 = new ScrollbackArchive({ rootDir: tempDir });

    const line = Array.from({ length: 80 }, (_, i) => ({
      char: String.fromCharCode(48 + (i % 10)),
      fg: { r: i, g: 255 - i, b: 128 },
      bg: { r: 0, g: 0, b: 0 },
      bold: i % 2 === 0,
      italic: i % 3 === 0,
      underline: false,
      strikethrough: false,
      inverse: false,
      blink: false,
      dim: false,
      width: 1 as const,
    }));

    await archive1.appendLines([line, line]);
    archive1.dispose();

    // Recreate and verify
    const archive2 = new ScrollbackArchive({ rootDir: tempDir });
    expect(archive2.length).toBe(2);

    const retrieved = archive2.getLine(0);
    expect(retrieved).not.toBeNull();
    expect(retrieved![0].char).toBe('0');
    expect(retrieved![0].fg.r).toBe(0);
    expect(retrieved![0].bold).toBe(true);

    archive2.dispose();
  });
});
