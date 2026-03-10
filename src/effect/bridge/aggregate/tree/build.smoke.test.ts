import { describe, it, expect } from 'vitest'
import { 
  buildSessionTreeNodes, 
  countTreeNodes, 
  countTotalPtys,
  findPtyNode,
  findSessionNode,
} from './build'
import type { SessionWithPtys, PtyMetadata, VisualTreeNode } from '../types'
import type { SessionMetadata } from '../../../models'

describe('buildSessionTreeNodes (smoke)', () => {
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

  it('should build tree with mixed loaded and unloaded sessions', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: [createPty('pty-1')], isActive: true, ptyCount: 1 },
      { session: createSession('s2'), ptys: 'unloaded', isActive: false, ptyCount: 3 },
      { session: createSession('s3'), ptys: [createPty('pty-2'), createPty('pty-3')], isActive: false, ptyCount: 2 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    expect(nodes).toHaveLength(7) // 3 sessions + 1 + 1 + 2 PTYs = 7 nodes
    
    // Session 1
    expect(nodes[0]).toMatchObject({ type: 'session', sessionId: 's1', isLast: false, isActive: true })
    expect(nodes[1]).toMatchObject({ type: 'pty', ptyId: 'pty-1', isLast: true })
    
    // Session 2 (unloaded)
    expect(nodes[2]).toMatchObject({ type: 'session', sessionId: 's2', isLast: false, isActive: false })
    expect(nodes[3]).toMatchObject({ type: 'placeholder', sessionId: 's2', count: 3 })
    
    // Session 3
    expect(nodes[4]).toMatchObject({ type: 'session', sessionId: 's3', isLast: true, isActive: false })
    expect(nodes[5]).toMatchObject({ type: 'pty', ptyId: 'pty-2', isLast: false })
    expect(nodes[6]).toMatchObject({ type: 'pty', ptyId: 'pty-3', isLast: true })
  })

  it('should count tree nodes correctly', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      { session: createSession('s2'), ptys: [createPty('pty-1')], isActive: false, ptyCount: 1 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    
    expect(countTreeNodes(nodes)).toBe(4) // 2 sessions + 1 placeholder + 1 PTY
  })

  it('should count total PTYs correctly', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 5 },
      { session: createSession('s2'), ptys: [createPty('pty-1'), createPty('pty-2')], isActive: false, ptyCount: 2 },
      { session: createSession('s3'), ptys: [createPty('pty-3')], isActive: false, ptyCount: 1 },
    ]
    
    expect(countTotalPtys(sessions)).toBe(3) // Only counts loaded PTYs
  })

  it('should find PTY node by ID', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: [createPty('pty-1'), createPty('pty-2')], isActive: false, ptyCount: 2 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    const found = findPtyNode(nodes, 'pty-2')
    
    expect(found).toBeDefined()
    expect(found!.ptyId).toBe('pty-2')
    expect(found!.sessionId).toBe('s1')
  })

  it('should find session node by ID', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: [], isActive: false, ptyCount: 0 },
      { session: createSession('s2'), ptys: [], isActive: true, ptyCount: 0 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    const found = findSessionNode(nodes, 's2')
    
    expect(found).toBeDefined()
    expect(found!.sessionId).toBe('s2')
    expect(found!.isActive).toBe(true)
  })

  it('should return undefined when PTY not found', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: [createPty('pty-1')], isActive: false, ptyCount: 1 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    const found = findPtyNode(nodes, 'non-existent')
    
    expect(found).toBeUndefined()
  })

  it('should return undefined when session not found', () => {
    const sessions: SessionWithPtys[] = [
      { session: createSession('s1'), ptys: [], isActive: false, ptyCount: 0 },
    ]
    
    const nodes = buildSessionTreeNodes(sessions)
    const found = findSessionNode(nodes, 'non-existent')
    
    expect(found).toBeUndefined()
  })
})
