import { describe, it, expect, beforeEach } from 'bun:test'
import { SessionPtyCache, DEFAULT_CACHE_MAX_AGE_MS } from './session-pty-cache'
import type { PtyId, SessionId } from '../../../types'

describe('SessionPtyCache (litmus)', () => {
  let cache: SessionPtyCache

  beforeEach(() => {
    cache = new SessionPtyCache()
  })

  it('should store and retrieve session-PTY mappings', () => {
    const sessionId = 'session-1' as SessionId
    const ptyIds = ['pty-1', 'pty-2'] as PtyId[]

    cache.set(sessionId, ptyIds, true)
    const entry = cache.get(sessionId)

    expect(entry).toBeDefined()
    expect(entry?.sessionId).toBe(sessionId)
    expect(entry?.isLoaded).toBe(true)
    expect([...entry!.ptyIds]).toEqual(ptyIds)
  })

  it('should map PTY to session bidirectionally', () => {
    const sessionId = 'session-1' as SessionId
    const ptyId = 'pty-1' as PtyId

    cache.set(sessionId, [ptyId], true)
    const foundSession = cache.getSessionForPty(ptyId)

    expect(foundSession).toBe(sessionId)
  })

  it('should expire entries after max age', () => {
    const shortCache = new SessionPtyCache(1) // 1ms expiration
    const sessionId = 'session-1' as SessionId
    const ptyId = 'pty-1' as PtyId

    shortCache.set(sessionId, [ptyId], true)
    
    // Wait for expiration
    return new Promise(resolve => setTimeout(resolve, 10)).then(() => {
      const entry = shortCache.get(sessionId)
      expect(entry).toBeUndefined()
    })
  })
})
