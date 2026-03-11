import { describe, it, expect, vi } from 'bun:test'
import { 
  loadSessionPtysWithService,
} from './lazy-load'
import type { SessionManager } from '../../../services/SessionManager'
import type { PtyService } from '../../../services/Pty'
import type { SessionId } from '../../../types'

describe('loadSessionPtysWithService (smoke)', () => {
  const createMockServices = () => ({
    sessionManager: {
      loadSession: vi.fn(),
    } as unknown as SessionManager,
    ptyService: {
      getSession: vi.fn().mockResolvedValue({ pid: 123, shell: '/bin/bash' }),
      getCwd: vi.fn().mockResolvedValue('/home/user'),
      getGitInfo: vi.fn().mockResolvedValue(undefined),
      getForegroundProcess: vi.fn().mockResolvedValue('bash'),
      getGitDiffStats: vi.fn().mockResolvedValue({ added: 0, deleted: 0 }),
      listAll: vi.fn(),
      create: vi.fn(),
    } as unknown as PtyService,
  })

  it('should return null when session not found', async () => {
    const { sessionManager, ptyService } = createMockServices()
    vi.mocked(sessionManager.loadSession).mockResolvedValue(new Error('Session not found'))
    
    const result = await loadSessionPtysWithService(ptyService, sessionManager, 'non-existent')
    
    expect(result).toBeNull()
  })

  it('should return empty array when no PTY mappings exist', async () => {
    const { sessionManager, ptyService } = createMockServices()
    
    vi.mocked(sessionManager.loadSession).mockResolvedValue({
      metadata: { id: 'session-1' as SessionId, name: 'Test', createdAt: 0, lastSwitchedAt: 0, autoNamed: false },
      activeWorkspaceId: 1,
      workspaces: [],
    } as unknown as import('../../../models').SerializedSession)
    
    const result = await loadSessionPtysWithService(ptyService, sessionManager, 'session-1')
    
    expect(result).toEqual([])
  })
})
