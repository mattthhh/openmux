import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SessionPtyCache, sessionPtyCache } from './session-pty-cache'
import type { PtyId, SessionId } from '../../../types'

describe('SessionPtyCache', () => {
  beforeEach(() => {
    sessionPtyCache.clear()
  })

  describe('get', () => {
    it('should return undefined for non-existent session', () => {
      const result = sessionPtyCache.get('non-existent' as SessionId)
      expect(result).toBeUndefined()
    })

    it('should return cached entry for existing session', () => {
      const sessionId = 'session-1' as SessionId
      const ptyIds = ['pty-1', 'pty-2'] as PtyId[]
      
      sessionPtyCache.set(sessionId, ptyIds, true)
      const entry = sessionPtyCache.get(sessionId)
      
      expect(entry).toMatchObject({
        sessionId,
        isLoaded: true,
      })
      expect([...entry!.ptyIds]).toEqual(ptyIds)
      expect(entry!.lastUpdated).toBeGreaterThan(0)
    })

    it('should return undefined for expired entries', () => {
      const cache = new SessionPtyCache(1) // 1ms expiration
      const sessionId = 'session-1' as SessionId
      
      cache.set(sessionId, ['pty-1'] as PtyId[], true)
      
      return new Promise<void>(resolve => {
        setTimeout(() => {
          const entry = cache.get(sessionId)
          expect(entry).toBeUndefined()
          resolve()
        }, 10)
      })
    })
  })

  describe('set', () => {
    it('should create new entry with current timestamp', () => {
      const before = Date.now()
      sessionPtyCache.set('session-1' as SessionId, ['pty-1'] as PtyId[], true)
      const after = Date.now()
      
      const entry = sessionPtyCache.get('session-1' as SessionId)
      expect(entry!.lastUpdated).toBeGreaterThanOrEqual(before)
      expect(entry!.lastUpdated).toBeLessThanOrEqual(after)
    })

    it('should update existing entry', () => {
      const sessionId = 'session-1' as SessionId
      sessionPtyCache.set(sessionId, ['pty-1'] as PtyId[], false)
      
      const firstEntry = sessionPtyCache.get(sessionId)!
      
      // Wait a bit to ensure different timestamp
      return new Promise<void>(resolve => {
        setTimeout(() => {
          sessionPtyCache.set(sessionId, ['pty-1', 'pty-2'] as PtyId[], true)
          
          const secondEntry = sessionPtyCache.get(sessionId)!
          expect(secondEntry.lastUpdated).toBeGreaterThan(firstEntry.lastUpdated)
          expect([...secondEntry.ptyIds]).toEqual(['pty-1', 'pty-2'])
          expect(secondEntry.isLoaded).toBe(true)
          resolve()
        }, 5)
      })
    })

    it('should clean up old bidirectional mappings', () => {
      const sessionId = 'session-1' as SessionId
      sessionPtyCache.set(sessionId, ['pty-1', 'pty-2'] as PtyId[], true)
      
      sessionPtyCache.set(sessionId, ['pty-3'] as PtyId[], true)
      
      expect(sessionPtyCache.getSessionForPty('pty-1' as PtyId)).toBeUndefined()
      expect(sessionPtyCache.getSessionForPty('pty-2' as PtyId)).toBeUndefined()
      expect(sessionPtyCache.getSessionForPty('pty-3' as PtyId)).toBe(sessionId)
    })
  })

  describe('getSessionForPty', () => {
    it('should return undefined for unmapped PTY', () => {
      const result = sessionPtyCache.getSessionForPty('unknown' as PtyId)
      expect(result).toBeUndefined()
    })

    it('should return correct session for mapped PTY', () => {
      sessionPtyCache.set('session-1' as SessionId, ['pty-1'] as PtyId[], true)
      sessionPtyCache.set('session-2' as SessionId, ['pty-2'] as PtyId[], true)
      
      expect(sessionPtyCache.getSessionForPty('pty-1' as PtyId)).toBe('session-1')
      expect(sessionPtyCache.getSessionForPty('pty-2' as PtyId)).toBe('session-2')
    })
  })

  describe('delete', () => {
    it('should remove entry and bidirectional mappings', () => {
      const sessionId = 'session-1' as SessionId
      sessionPtyCache.set(sessionId, ['pty-1'] as PtyId[], true)
      
      sessionPtyCache.delete(sessionId)
      
      expect(sessionPtyCache.get(sessionId)).toBeUndefined()
      expect(sessionPtyCache.getSessionForPty('pty-1' as PtyId)).toBeUndefined()
    })

    it('should handle delete of non-existent session gracefully', () => {
      expect(() => sessionPtyCache.delete('non-existent' as SessionId)).not.toThrow()
    })
  })

  describe('clear', () => {
    it('should remove all entries', () => {
      sessionPtyCache.set('s1' as SessionId, ['p1'] as PtyId[], true)
      sessionPtyCache.set('s2' as SessionId, ['p2'] as PtyId[], true)
      
      sessionPtyCache.clear()
      
      expect(sessionPtyCache.get('s1' as SessionId)).toBeUndefined()
      expect(sessionPtyCache.get('s2' as SessionId)).toBeUndefined()
    })

    it('should remove all bidirectional mappings', () => {
      sessionPtyCache.set('s1' as SessionId, ['p1'] as PtyId[], true)
      
      sessionPtyCache.clear()
      
      expect(sessionPtyCache.getSessionForPty('p1' as PtyId)).toBeUndefined()
    })
  })

  describe('keys', () => {
    it('should return all cached session IDs', () => {
      sessionPtyCache.set('s1' as SessionId, [] as PtyId[], true)
      sessionPtyCache.set('s2' as SessionId, [] as PtyId[], true)
      sessionPtyCache.set('s3' as SessionId, [] as PtyId[], true)
      
      const keys = [...sessionPtyCache.keys()]
      expect(keys).toHaveLength(3)
      expect(keys).toContain('s1')
      expect(keys).toContain('s2')
      expect(keys).toContain('s3')
    })
  })

  describe('custom maxAgeMs', () => {
    it('should respect custom expiration time', () => {
      const cache = new SessionPtyCache(100) // 100ms
      cache.set('s1' as SessionId, ['p1'] as PtyId[], true)
      
      // Entry should exist immediately
      expect(cache.get('s1' as SessionId)).toBeDefined()
      
      // Entry should exist after 50ms
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(cache.get('s1' as SessionId)).toBeDefined()
          
          // Entry should expire after 150ms total
          setTimeout(() => {
            expect(cache.get('s1' as SessionId)).toBeUndefined()
            resolve()
          }, 100)
        }, 50)
      })
    })
  })
})
