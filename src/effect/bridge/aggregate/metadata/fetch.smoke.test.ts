import { describe, it, expect, vi } from 'vitest'
import { fetchPtyMetadata, batchFetchPtyMetadata } from './fetch'
import type { PtyService } from '../../../services/Pty'
import type { PtyId } from '../../../types'
import type { GitInfo } from '../../../services/pty/helpers'

describe('fetchPtyMetadata (smoke)', () => {
  const createMockPtyService = (overrides = {}) => ({
    getSession: vi.fn().mockResolvedValue({ pid: 123, shell: '/bin/bash' }),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    getGitInfo: vi.fn().mockResolvedValue(undefined),
    getForegroundProcess: vi.fn().mockResolvedValue('bash'),
    getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
    ...overrides,
  }) as unknown as PtyService

  it('should handle error in getCwd gracefully', async () => {
    const error = new Error('CWD not available')
    const pty = createMockPtyService({
      getCwd: vi.fn().mockResolvedValue(error),
    })
    
    const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
    
    expect(result).not.toBeNull()
    expect(result!.cwd).toBe(process.cwd()) // Falls back to process.cwd()
  })

  it('should handle git info fetch failure gracefully', async () => {
    const pty = createMockPtyService({
      getGitInfo: vi.fn().mockRejectedValue(new Error('Not a git repo')),
    })
    
    const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
    
    expect(result).not.toBeNull()
    expect(result!.gitBranch).toBeUndefined()
    expect(result!.gitDirty).toBe(false)
  })

  it('should skip git diff stats when option is set', async () => {
    const getGitDiffStats = vi.fn().mockResolvedValue({ added: 10, deleted: 5 })
    const pty = createMockPtyService({ getGitDiffStats })
    
    await fetchPtyMetadata(pty, 'pty-1' as PtyId, { skipGitDiffStats: true })
    
    expect(getGitDiffStats).not.toHaveBeenCalled()
  })

  it('should handle git diff stats fetch failure gracefully', async () => {
    const pty = createMockPtyService({
      getGitDiffStats: vi.fn().mockRejectedValue(new Error('Git diff failed')),
    })
    
    const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
    
    expect(result).not.toBeNull()
    expect(result!.gitDiffStats).toBeUndefined()
  })

  it('should handle foreground process fetch failure gracefully', async () => {
    const pty = createMockPtyService({
      getForegroundProcess: vi.fn().mockRejectedValue(new Error('Process fetch failed')),
    })
    
    const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
    
    expect(result).not.toBeNull()
    expect(result!.foregroundProcess).toBeUndefined()
  })

  it('should return null when getSession returns an Error', async () => {
    const { PtyNotFoundError } = await import('../../../errors')
    const pty = createMockPtyService({
      getSession: vi.fn().mockResolvedValue(new PtyNotFoundError({ ptyId: 'pty-1' })),
    })
    
    const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
    
    expect(result).toBeNull()
  })
})

describe('batchFetchPtyMetadata (smoke)', () => {
  const createMockPtyService = () => ({
    getSession: vi.fn().mockImplementation((id: PtyId) => 
      Promise.resolve({ pid: 100 + parseInt(id as string), shell: '/bin/bash' })
    ),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    getGitInfo: vi.fn().mockResolvedValue(undefined),
    getForegroundProcess: vi.fn().mockResolvedValue('bash'),
    getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
  }) as unknown as PtyService

  it('should fetch multiple PTYs in batches', async () => {
    const pty = createMockPtyService()
    const ptyIds = ['pty-1', 'pty-2', 'pty-3'] as PtyId[]
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, ptyIds, {}, 2)) {
      results.push(metadata)
    }
    
    expect(results).toHaveLength(3)
    expect(results[0]?.ptyId).toBe('pty-1')
    expect(results[1]?.ptyId).toBe('pty-2')
    expect(results[2]?.ptyId).toBe('pty-3')
  })

  it('should respect batch size', async () => {
    const pty = createMockPtyService()
    const ptyIds = ['pty-1', 'pty-2', 'pty-3', 'pty-4', 'pty-5'] as PtyId[]
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, ptyIds, {}, 2)) {
      results.push(metadata)
    }
    
    // Should still get all 5 results, just processed in smaller batches
    expect(results).toHaveLength(5)
  })

  it('should handle empty PTY list', async () => {
    const pty = createMockPtyService()
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, [], {})) {
      results.push(metadata)
    }
    
    expect(results).toHaveLength(0)
  })

  it('should filter out invalid PTYs', async () => {
    const pty = {
      getSession: vi.fn()
        .mockResolvedValueOnce({ pid: 0, shell: '/bin/bash' }) // Invalid
        .mockResolvedValueOnce({ pid: 123, shell: '/bin/bash' }) // Valid
        .mockResolvedValueOnce({ pid: 0, shell: '/bin/bash' }), // Invalid
      getCwd: vi.fn().mockResolvedValue('/home/user'),
      getGitInfo: vi.fn().mockResolvedValue(undefined),
      getForegroundProcess: vi.fn().mockResolvedValue('bash'),
      getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
    } as unknown as PtyService
    
    const ptyIds = ['pty-1', 'pty-2', 'pty-3'] as PtyId[]
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, ptyIds, {})) {
      results.push(metadata)
    }
    
    expect(results).toHaveLength(1)
    expect(results[0]?.ptyId).toBe('pty-2')
  })
})
