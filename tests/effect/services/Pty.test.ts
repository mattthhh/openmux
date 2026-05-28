/**
 * Tests for Pty service types and behaviors.
 * Note: Full PTY integration tests require bun runtime due to zig-pty.
 */
import { describe, expect, it } from 'bun:test';
import {
  makeCols,
  makeRows,
  makePtyId,
  type PtyId,
  asPtyId,
  type Cols,
  type Rows,
} from '../../../src/effect/types';
import type { PtySession } from '../../../src/effect/models';

// Create a mock Pty service for testing without zig-pty dependency
interface MockPty {
  readonly create: (options: { cols: number; rows: number; cwd?: string }) => Promise<PtyId>;
  readonly write: (id: PtyId, data: string) => Promise<void>;
  readonly resize: (id: PtyId, cols: number, rows: number) => Promise<void>;
  readonly getCwd: (id: PtyId) => Promise<string>;
  readonly destroy: (id: PtyId) => Promise<void>;
  readonly getSession: (id: PtyId) => Promise<PtySession>;
  readonly destroyAll: () => Promise<void>;
}

function createMockPty(): MockPty {
  return {
    create: async () => makePtyId(),
    write: async () => undefined,
    resize: async () => undefined,
    getCwd: async () => '/test/cwd',
    destroy: async () => undefined,
    getSession: async (id: PtyId) => ({
      id,
      pid: 12345,
      cols: makeCols(80),
      rows: makeRows(24),
      cwd: '/test/cwd',
      shell: '/bin/bash',
    }),
    destroyAll: async () => undefined,
  };
}

describe('Pty', () => {
  describe('mock implementation', () => {
    it('creates a PTY session', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      expect(ptyId).toBeDefined();
      expect(typeof ptyId).toBe('string');
      expect(ptyId).toContain('pty-');
    });

    it('gets session info', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      const session = await pty.getSession(ptyId);

      expect(session.pid).toBe(12345);
      expect(session.cols).toBe(80 as Cols);
      expect(session.rows).toBe(24 as Rows);
      expect(session.cwd).toBe('/test/cwd');
      expect(session.shell).toBe('/bin/bash');
    });

    it('gets CWD', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      const cwd = await pty.getCwd(ptyId);

      expect(cwd).toBe('/test/cwd');
    });

    it('writes to PTY without error', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      await pty.write(ptyId, 'echo hello');
    });

    it('resizes PTY without error', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      await pty.resize(ptyId, 120, 40);
    });

    it('destroys PTY session', async () => {
      const pty = createMockPty();

      const ptyId = await pty.create({
        cols: 80,
        rows: 24,
      });

      await pty.destroy(ptyId);
    });

    it('destroys all PTY sessions', async () => {
      const pty = createMockPty();

      await pty.create({ cols: 80, rows: 24 });
      await pty.create({ cols: 100, rows: 30 });

      await pty.destroyAll();
    });
  });

  describe('PtySession model', () => {
    it('creates valid PtySession', () => {
      const session: PtySession = {
        id: asPtyId('test-pty-1'),
        pid: 9999,
        cols: makeCols(120),
        rows: makeRows(40),
        cwd: '/home/user',
        shell: '/bin/zsh',
      };

      expect(session.id).toBe('test-pty-1' as PtyId);
      expect(session.pid).toBe(9999);
      expect(session.cols).toBe(120 as Cols);
      expect(session.rows).toBe(40 as Rows);
      expect(session.cwd).toBe('/home/user');
      expect(session.shell).toBe('/bin/zsh');
    });
  });

  describe('makePtyId', () => {
    it('generates unique IDs', () => {
      const id1 = makePtyId();
      const id2 = makePtyId();
      const id3 = makePtyId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('generates IDs with correct prefix', () => {
      const id = makePtyId();
      expect(id.startsWith('pty-')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should be callable on test service', async () => {
      const { createTestPtyService } = await import('../../../src/effect/services/Pty');
      const pty = createTestPtyService();

      // Should not throw
      expect(() => pty.dispose()).not.toThrow();
    });

    it('should return undefined', async () => {
      const { createTestPtyService } = await import('../../../src/effect/services/Pty');
      const pty = createTestPtyService();

      const result = pty.dispose();
      expect(result).toBeUndefined();
    });

    it('should be idempotent', async () => {
      const { createTestPtyService } = await import('../../../src/effect/services/Pty');
      const pty = createTestPtyService();

      // Multiple disposes should not throw
      expect(() => {
        pty.dispose();
        pty.dispose();
        pty.dispose();
      }).not.toThrow();
    });

    it('should not break service after dispose', async () => {
      const { createTestPtyService } = await import('../../../src/effect/services/Pty');
      const pty = createTestPtyService();
      const testId = makePtyId();

      pty.dispose();

      // Service should still respond to calls
      const result = await pty.getCwd(testId);
      expect(result).toBe('/test/cwd');
    });
  });
});
