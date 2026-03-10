import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPtyMetadata, batchFetchPtyMetadata, fetchPtyMetadataSafe } from './fetch'
import { asPtyId } from '../cache/session-pty-cache'
import type { PtyService } from '../../../services/Pty'
import type { PtyId } from '../../../types'
import type { GitInfo } from '../../../services/pty/helpers'
import { PtyMetadataError } from '../../../errors'

describe('fetchPtyMetadata', () => {
  const createMockPtyService = (overrides = {}): PtyService => ({
    getSession: vi.fn().mockResolvedValue({ pid: 123, shell: '/bin/bash' }),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    getGitInfo: vi.fn().mockResolvedValue(undefined),
    getForegroundProcess: vi.fn().mockResolvedValue('bash'),
    getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
    ...overrides,
  }) as unknown as PtyService

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('session validation', () => {
    it('should return null when session pid is 0', async () => {
      const pty = createMockPtyService({
        getSession: vi.fn().mockResolvedValue({ pid: 0, shell: '/bin/bash' }),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toBeNull()
    })

    it('should return null when getSession returns Error', async () => {
      const pty = createMockPtyService({
        getSession: vi.fn().mockResolvedValue(new Error('Session not found')),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toBeNull()
    })
  })

  describe('defunct process detection', () => {
    it('should return null for defunct processes', async () => {
      const pty = createMockPtyService({
        getForegroundProcess: vi.fn().mockResolvedValue('chrome <defunct>'),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toBeNull()
    })

    it('should return null for processes containing defunct in middle', async () => {
      const pty = createMockPtyService({
        getForegroundProcess: vi.fn().mockResolvedValue('node <defunct> process'),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toBeNull()
    })
  })

  describe('metadata construction', () => {
    it('should include all git metadata fields', async () => {
      const gitInfo: GitInfo = {
        branch: 'feature-branch',
        dirty: true,
        staged: 3,
        unstaged: 2,
        untracked: 1,
        conflicted: 0,
        ahead: 5,
        behind: 3,
        stashCount: 2,
        state: 'rebase',
        detached: true,
        repoKey: 'my-repo',
      }
      
      const pty = createMockPtyService({
        getGitInfo: vi.fn().mockResolvedValue(gitInfo),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toMatchObject({
        ptyId: 'pty-1',
        gitBranch: 'feature-branch',
        gitDirty: true,
        gitStaged: 3,
        gitUnstaged: 2,
        gitUntracked: 1,
        gitConflicted: 0,
        gitAhead: 5,
        gitBehind: 3,
        gitStashCount: 2,
        gitState: 'rebase',
        gitDetached: true,
        gitRepoKey: 'my-repo',
      })
    })

    it('should use defaults for missing git info', async () => {
      const pty = createMockPtyService({
        getGitInfo: vi.fn().mockResolvedValue(undefined),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result!.gitDirty).toBe(false)
      expect(result!.gitStaged).toBe(0)
      expect(result!.gitUnstaged).toBe(0)
      expect(result!.gitUntracked).toBe(0)
      expect(result!.gitConflicted).toBe(0)
      expect(result!.gitDetached).toBe(false)
    })

    it('should include shell from session', async () => {
      const pty = createMockPtyService({
        getSession: vi.fn().mockResolvedValue({ pid: 123, shell: '/usr/bin/zsh' }),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result!.shell).toBe('/usr/bin/zsh')
    })

    it('should set workspaceId and paneId as undefined initially', async () => {
      const pty = createMockPtyService()
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result!.workspaceId).toBeUndefined()
      expect(result!.paneId).toBeUndefined()
    })
  })

  describe('parallel fetching', () => {
    it('should fetch all data in parallel', async () => {
      const order: string[] = []
      
      const pty = createMockPtyService({
        getSession: vi.fn().mockImplementation(() => {
          order.push('session')
          return Promise.resolve({ pid: 123, shell: '/bin/bash' })
        }),
        getCwd: vi.fn().mockImplementation(() => {
          order.push('cwd')
          return Promise.resolve('/home/user')
        }),
        getGitInfo: vi.fn().mockImplementation(() => {
          order.push('gitInfo')
          return Promise.resolve(undefined)
        }),
        getForegroundProcess: vi.fn().mockImplementation(() => {
          order.push('foreground')
          return Promise.resolve('bash')
        }),
      })
      
      await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      // All should be called (we can't guarantee order due to parallelism)
      expect(order).toContain('session')
      expect(order).toContain('cwd')
      expect(order).toContain('gitInfo')
      expect(order).toContain('foreground')
    })
  })

  describe('error handling', () => {
    it('should catch any unexpected error and return null', async () => {
      const pty = createMockPtyService({
        getSession: vi.fn().mockImplementation(() => {
          throw new Error('Unexpected crash')
        }),
      })
      
      const result = await fetchPtyMetadata(pty, 'pty-1' as PtyId)
      
      expect(result).toBeNull()
    })
  })
})

describe('batchFetchPtyMetadata', () => {
  const createMockPtyService = (): PtyService => ({
    getSession: vi.fn().mockImplementation((id: PtyId) => 
      Promise.resolve({ pid: 100 + parseInt(id as string), shell: '/bin/bash' })
    ),
    getCwd: vi.fn().mockResolvedValue('/home/user'),
    getGitInfo: vi.fn().mockResolvedValue(undefined),
    getForegroundProcess: vi.fn().mockResolvedValue('bash'),
    getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
  }) as unknown as PtyService

  it('should process all PTYs when batchSize equals count', async () => {
    const pty = createMockPtyService()
    const ptyIds = ['pty-1', 'pty-2', 'pty-3'] as PtyId[]
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, ptyIds, {}, 3)) {
      results.push(metadata)
    }
    
    expect(results).toHaveLength(3)
  })

  it('should handle partial batches', async () => {
    const pty = createMockPtyService()
    const ptyIds = ['pty-1', 'pty-2', 'pty-3', 'pty-4', 'pty-5'] as PtyId[]
    
    const results: Awaited<ReturnType<typeof fetchPtyMetadata>>[] = []
    for await (const metadata of batchFetchPtyMetadata(pty, ptyIds, {}, 2)) {
      results.push(metadata)
    }
    
    expect(results).toHaveLength(5)
  })

  it('should apply options to all batches', async () => {
    const getGitDiffStats = vi.fn().mockResolvedValue({ added: 0, deleted: 0 })
    const pty = {
      getSession: vi.fn().mockResolvedValue({ pid: 123, shell: '/bin/bash' }),
      getCwd: vi.fn().mockResolvedValue('/home/user'),
      getGitInfo: vi.fn().mockResolvedValue(undefined),
      getForegroundProcess: vi.fn().mockResolvedValue('bash'),
      getGitDiffStats,
    } as unknown as PtyService
    
    const ptyIds = ['pty-1', 'pty-2', 'pty-3', 'pty-4'] as PtyId[]
    
    for await (const _ of batchFetchPtyMetadata(pty, ptyIds, { skipGitDiffStats: true }, 2)) {
      // consume
    }
    
    expect(getGitDiffStats).not.toHaveBeenCalled()
  })
})

describe('fetchPtyMetadataSafe', () => {
  it('should return PtyMetadataError on failure', async () => {
    const pty = {
      getSession: vi.fn().mockRejectedValue(new Error('Service error')),
    } as unknown as PtyService
    
    const result = await fetchPtyMetadataSafe(pty, 'pty-1' as PtyId)
    
    expect(result).toBeInstanceOf(PtyMetadataError)
    expect((result as PtyMetadataError).ptyId).toBe('pty-1')
  })
})

describe('asPtyId', () => {
  it('should type cast string to PtyId', () => {
    const id = 'test-pty-123'
    const ptyId = asPtyId(id)
    
    expect(ptyId).toBe(id)
    // Type assertion - at runtime they're the same
    expect(typeof ptyId).toBe('string')
  })
})
