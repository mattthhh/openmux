import { describe, it, expect, beforeEach } from 'bun:test'
import { 
  SessionPtyCache, 
  sessionPtyCache,
  aggregateSessionMappings,
  clearAllCaches,
  invalidateSessionCache,
} from './session-pty-cache'
import type { PtyId, SessionId } from '../../../types'

describe('SessionPtyCache (smoke)', () => {
  beforeEach(() => {
    clearAllCaches()
  })

  it('should use global cache instance', () => {
    const sessionId = 'global-session' as SessionId
    const ptyIds = ['pty-a', 'pty-b'] as PtyId[]

    sessionPtyCache.set(sessionId, ptyIds, true)
    
    // Same instance should return the value
    const entry = sessionPtyCache.get(sessionId)
    expect(entry).toBeDefined()
    expect([...entry!.ptyIds]).toEqual(ptyIds)
  })

  it('should handle aggregate session mappings', () => {
    aggregateSessionMappings.set('session-1', new Map([['pane-1', 'pty-1']]))
    
    expect(aggregateSessionMappings.has('session-1')).toBe(true)
    expect(aggregateSessionMappings.get('session-1')?.get('pane-1')).toBe('pty-1')
  })

  it('should invalidate specific session cache', () => {
    const sessionId = 'session-1' as SessionId
    sessionPtyCache.set(sessionId, ['pty-1'] as PtyId[], true)
    aggregateSessionMappings.set('session-1', new Map())

    invalidateSessionCache('session-1')

    expect(sessionPtyCache.get(sessionId)).toBeUndefined()
    expect(aggregateSessionMappings.has('session-1')).toBe(false)
  })

  it('should clear all caches', () => {
    sessionPtyCache.set('s1' as SessionId, ['p1'] as PtyId[], true)
    sessionPtyCache.set('s2' as SessionId, ['p2'] as PtyId[], true)
    aggregateSessionMappings.set('s1', new Map())

    clearAllCaches()

    expect(sessionPtyCache.get('s1' as SessionId)).toBeUndefined()
    expect(sessionPtyCache.get('s2' as SessionId)).toBeUndefined()
    expect(aggregateSessionMappings.has('s1')).toBe(false)
  })

  it('should update bidirectional mappings on set', () => {
    const sessionId = 'session-1' as SessionId
    const ptyId1 = 'pty-1' as PtyId
    const ptyId2 = 'pty-2' as PtyId

    sessionPtyCache.set(sessionId, [ptyId1, ptyId2], true)

    expect(sessionPtyCache.getSessionForPty(ptyId1)).toBe(sessionId)
    expect(sessionPtyCache.getSessionForPty(ptyId2)).toBe(sessionId)
  })

  it('should clean up old bidirectional mappings on update', () => {
    const sessionId = 'session-1' as SessionId
    const oldPtyId = 'pty-old' as PtyId
    const newPtyId = 'pty-new' as PtyId

    sessionPtyCache.set(sessionId, [oldPtyId], true)
    expect(sessionPtyCache.getSessionForPty(oldPtyId)).toBe(sessionId)

    // Update with new PTY
    sessionPtyCache.set(sessionId, [newPtyId], true)
    
    expect(sessionPtyCache.getSessionForPty(oldPtyId)).toBeUndefined()
    expect(sessionPtyCache.getSessionForPty(newPtyId)).toBe(sessionId)
  })
})
