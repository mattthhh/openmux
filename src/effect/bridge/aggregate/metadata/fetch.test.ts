import { beforeEach, describe, it, expect, vi } from 'bun:test';

import { fetchPtyMetadata } from './fetch';
import { asPtyId } from '../cache/session-pty-cache';
import type { PtyService } from '../../../services/Pty';
import type { PtyId } from '../../../types';

describe('fetchPtyMetadata (litmus)', () => {
  const mockPtyService = {
    getSession: vi.fn(),
    getCwd: vi.fn(),
    getGitInfo: vi.fn(),
    getForegroundProcess: vi.fn(),
    getGitDiffStats: vi.fn(),
  } as unknown as PtyService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null for invalid session', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({
      pid: 0,
      shell: '/bin/bash',
      cwd: '/tmp',
    });

    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId);

    expect(result).toBeNull();
  });

  it('should skip defunct processes', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({
      pid: 123,
      shell: '/bin/bash',
      cwd: '/home/user',
    });
    vi.mocked(mockPtyService.getCwd).mockResolvedValue('/home/user');
    vi.mocked(mockPtyService.getForegroundProcess).mockResolvedValue('node <defunct>');

    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId);

    expect(result).toBeNull();
  });

  it('should return valid metadata for active PTY', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({
      pid: 123,
      shell: '/bin/zsh',
      cwd: '/home/user/project',
    });
    vi.mocked(mockPtyService.getCwd).mockResolvedValue('/home/user/project');
    vi.mocked(mockPtyService.getForegroundProcess).mockResolvedValue('nvim');

    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId);

    expect(result).toMatchObject({
      ptyId: 'pty-1',
      cwd: '/home/user/project',
      shell: '/bin/zsh',
      foregroundProcess: 'nvim',
      gitBranch: undefined,
      gitDirty: false,
      gitStaged: 0,
      gitDiffStats: undefined,
    });
    expect(mockPtyService.getGitInfo).not.toHaveBeenCalled();
    expect(mockPtyService.getGitDiffStats).not.toHaveBeenCalled();
  });

  it('should use the PTY session cwd instead of process.cwd() when cwd lookup fails', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({
      pid: 123,
      shell: '/bin/zsh',
      cwd: '/tmp/actual-pty-cwd',
    });
    vi.mocked(mockPtyService.getCwd).mockResolvedValue(new Error('pty disappeared mid-refresh'));
    vi.mocked(mockPtyService.getForegroundProcess).mockResolvedValue('nvim');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId, {
      skipGitDiffStats: true,
    });

    expect(result?.cwd).toBe('/tmp/actual-pty-cwd');
    expect(result?.cwd).not.toBe(process.cwd());
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to get cwd for PTY pty-1, using session cwd fallback:',
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });
});

describe('asPtyId (litmus)', () => {
  it('should cast string to PtyId branded type', () => {
    const ptyId = asPtyId('pty-123');
    expect(ptyId).toBe('pty-123');
    expect(typeof ptyId).toBe('string');
  });
});
