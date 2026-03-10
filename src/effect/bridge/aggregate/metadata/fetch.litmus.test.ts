import { describe, it, expect, vi } from 'vitest'
import { fetchPtyMetadata, batchFetchPtyMetadata } from './fetch'
import { asPtyId } from '../cache/session-pty-cache'
import type { PtyService } from '../../../services/Pty'
import type { PtyId } from '../../../types'

describe('fetchPtyMetadata (litmus)', () => {
  const mockPtyService = {
    getSession: vi.fn(),
    getCwd: vi.fn(),
    getGitInfo: vi.fn(),
    getForegroundProcess: vi.fn(),
    getGitDiffStats: vi.fn(),
  } as unknown as PtyService

  it('should return null for invalid session', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({ pid: 0, shell: '/bin/bash' })
    
    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId)
    
    expect(result).toBeNull()
  })

  it('should skip defunct processes', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({ pid: 123, shell: '/bin/bash' })
    vi.mocked(mockPtyService.getCwd).mockResolvedValue('/home/user')
    vi.mocked(mockPtyService.getGitInfo).mockResolvedValue(undefined)
    vi.mocked(mockPtyService.getForegroundProcess).mockResolvedValue('node <defunct>')
    
    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId)
    
    expect(result).toBeNull()
  })

  it('should return valid metadata for active PTY', async () => {
    vi.mocked(mockPtyService.getSession).mockResolvedValue({ pid: 123, shell: '/bin/zsh' })
    vi.mocked(mockPtyService.getCwd).mockResolvedValue('/home/user/project')
    vi.mocked(mockPtyService.getGitInfo).mockResolvedValue({
      branch: 'main',
      dirty: true,
      staged: 1,
      unstaged: 2,
      untracked: 3,
      conflicted: 0,
      ahead: 1,
      behind: 0,
      stashCount: 0,
      state: 'clean',
      detached: false,
      repoKey: 'project-repo',
    })
    vi.mocked(mockPtyService.getForegroundProcess).mockResolvedValue('nvim')
    vi.mocked(mockPtyService.getGitDiffStats).mockResolvedValue({ added: 10, deleted: 5 })
    
    const result = await fetchPtyMetadata(mockPtyService, 'pty-1' as PtyId)
    
    expect(result).toMatchObject({
      ptyId: 'pty-1',
      cwd: '/home/user/project',
      shell: '/bin/zsh',
      foregroundProcess: 'nvim',
      gitBranch: 'main',
      gitDirty: true,
      gitStaged: 1,
    })
  })
})

describe('asPtyId (litmus)', () => {
  it('should cast string to PtyId branded type', () => {
    const ptyId = asPtyId('pty-123')
    expect(ptyId).toBe('pty-123')
    expect(typeof ptyId).toBe('string')
  })
})
