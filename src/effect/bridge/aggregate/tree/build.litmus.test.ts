import { describe, it, expect } from 'bun:test'
import { buildSessionTreeNodes } from './build'
import type { SessionWithPtys, PtyMetadata } from '../types'
import type { SessionMetadata } from '../../../models'

describe('buildSessionTreeNodes (litmus)', () => {
  const createSession = (id: string, isActive = false): SessionMetadata => ({
    id: id as unknown as import('../../../types').SessionId,
    name: `Session ${id}`,
    createdAt: Date.now(),
    lastSwitchedAt: Date.now(),
    autoNamed: false,
    
  })

  const createPty = (id: string): PtyMetadata => ({
    ptyId: id,
    cwd: '/home/user',
    gitBranch: undefined,
    gitDiffStats: undefined,
    gitDirty: false,
    gitStaged: 0,
    gitUnstaged: 0,
    gitUntracked: 0,
    gitConflicted: 0,
    gitAhead: undefined,
    gitBehind: undefined,
    gitStashCount: undefined,
    gitState: undefined,
    gitDetached: false,
    gitRepoKey: undefined,
    foregroundProcess: 'bash',
    shell: '/bin/bash',
    title: undefined,
    workspaceId: undefined,
    paneId: undefined,
  })

  it('should create session nodes for each session', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      { session: createSession('s2'), ptys: 'unloaded', isActive: true, ptyCount: 0 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    const sessionNodes = nodes.filter(n => n.type === 'session')
    expect(sessionNodes).toHaveLength(2)
    expect(sessionNodes[0].sessionId).toBe('s1')
    expect(sessionNodes[1].sessionId).toBe('s2')
  })

  it('should mark last session correctly', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      { session: createSession('s2'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    const sessionNodes = nodes.filter(n => n.type === 'session')
    expect(sessionNodes[0].isLast).toBe(false)
    expect(sessionNodes[1].isLast).toBe(true)
  })

  it('should create placeholder for unloaded sessions', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 5 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    const placeholder = nodes.find(n => n.type === 'placeholder')
    expect(placeholder).toBeDefined()
    expect(placeholder!.count).toBe(5)
  })

  it('should create PTY nodes for loaded sessions', () => {
    const sessions: SessionWithPtys[] = [
      { 
        session: createSession('s1'), 
        ptys: [createPty('pty-1'), createPty('pty-2')], 
        isActive: true, 
        ptyCount: 2 
      },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    const ptyNodes = nodes.filter(n => n.type === 'pty')
    expect(ptyNodes).toHaveLength(2)
    expect(ptyNodes[0].ptyId).toBe('pty-1')
    expect(ptyNodes[1].ptyId).toBe('pty-2')
  })
})
