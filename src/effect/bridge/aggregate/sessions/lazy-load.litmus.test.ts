import { describe, it, expect, vi } from 'bun:test'
import { loadSessionPtysOnDemand } from './lazy-load'
import type { SessionManager } from '../../../services/SessionManager'
import type { PtyService } from '../../../services/Pty'
import type { SerializedSession, SerializedLayoutNode } from '../../../models'
import type { SessionId } from '../../../types'
import { ServicesNotInitializedError } from '../../../errors'

// Mock the services-instance module
vi.mock('../../services-instance', () => ({
  hasServices: vi.fn().mockReturnValue(true),
  getPtyService: vi.fn(),
  getSessionManager: vi.fn(),
}))

describe('loadSessionPtysOnDemand (litmus)', () => {
  it('should return error when services not initialized', async () => {
    const { hasServices } = await import('../../services-instance')
    vi.mocked(hasServices).mockReturnValueOnce(false)
    
    const result = await loadSessionPtysOnDemand('session-1')
    
    expect(result).toBeInstanceOf(ServicesNotInitializedError)
  })
})
