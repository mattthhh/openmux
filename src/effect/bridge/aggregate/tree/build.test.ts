import { describe, it, expect } from 'bun:test'
import { 
  buildSessionTreeNodes, 
  countTreeNodes, 
  countTotalPtys,
  findPtyNode,
  findSessionNode,
} from './build'
import type { SessionWithPtys, PtyMetadata } from '../types'
import type { SessionMetadata } from '../../../models'

describe('buildSessionTreeNodes', () => {
  const createSession = (id: string, isActive = false): SessionMetadata => ({
    id: id as unknown as import('../../../types').SessionId,
    name: `Session ${id}`,
    createdAt: Date.now(),
    lastSwitchedAt: Date.now(),
    autoNamed: false,
    
  })

  const createPty = (id: string, overrides = {}): PtyMetadata => ({
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
    ...overrides,
  })

  describe('session nodes', () => {
    it('should create session node for each session', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      
      expect(nodes[0]).toMatchObject({
        type: 'session',
        sessionId: 's1',
        isActive: false,
        isLast: true,
      })
    })

    it('should mark only last session as isLast', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
        { session: createSession('s2'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
        { session: createSession('s3'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const sessionNodes = nodes.filter(n => n.type === 'session')
      
      expect(sessionNodes[0].isLast).toBe(false)
      expect(sessionNodes[1].isLast).toBe(false)
      expect(sessionNodes[2].isLast).toBe(true)
    })

    it('should preserve isActive flag', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
        { session: createSession('s2'), ptys: 'unloaded', isActive: true, ptyCount: 0 },
        { session: createSession('s3'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const sessionNodes = nodes.filter(n => n.type === 'session')
      
      expect(sessionNodes[0].isActive).toBe(false)
      expect(sessionNodes[1].isActive).toBe(true)
      expect(sessionNodes[2].isActive).toBe(false)
    })

    it('should handle empty sessions array', () => {
      const nodes = buildSessionTreeNodes([])
      
      expect(nodes).toHaveLength(0)
    })
  })

  describe('PTY nodes', () => {
    it('should create PTY node for each loaded PTY', () => {
      const sessions: SessionWithPtys[] = [
        { 
          session: createSession('s1'), 
          ptys: [createPty('pty-1'), createPty('pty-2'), createPty('pty-3')], 
          isActive: false, 
          ptyCount: 3 
        },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const ptyNodes = nodes.filter(n => n.type === 'pty')
      
      expect(ptyNodes).toHaveLength(3)
      expect(ptyNodes[0].ptyId).toBe('pty-1')
      expect(ptyNodes[1].ptyId).toBe('pty-2')
      expect(ptyNodes[2].ptyId).toBe('pty-3')
    })

    it('should mark only last PTY in session as isLast', () => {
      const sessions: SessionWithPtys[] = [
        { 
          session: createSession('s1'), 
          ptys: [createPty('pty-1'), createPty('pty-2')], 
          isActive: false, 
          ptyCount: 2 
        },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const ptyNodes = nodes.filter(n => n.type === 'pty')
      
      expect(ptyNodes[0].isLast).toBe(false)
      expect(ptyNodes[1].isLast).toBe(true)
    })

    it('should include full ptyInfo in PTY nodes', () => {
      const pty = createPty('pty-1', {
        cwd: '/home/user/project',
        gitBranch: 'main',
        gitDirty: true,
        foregroundProcess: 'nvim',
      })
      
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: [pty], isActive: false, ptyCount: 1 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const ptyNode = nodes.find(n => n.type === 'pty')!
      
      expect(ptyNode.ptyInfo).toMatchObject({
        ptyId: 'pty-1',
        cwd: '/home/user/project',
        gitBranch: 'main',
        gitDirty: true,
        foregroundProcess: 'nvim',
      })
    })

    it('should include sessionId in PTY nodes', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: [createPty('pty-1')], isActive: false, ptyCount: 1 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const ptyNode = nodes.find(n => n.type === 'pty')!
      
      expect(ptyNode.sessionId).toBe('s1')
    })
  })

  describe('placeholder nodes', () => {
    it('should create placeholder for unloaded sessions', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 5 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const placeholder = nodes.find(n => n.type === 'placeholder')
      
      expect(placeholder).toBeDefined()
      expect(placeholder).toMatchObject({
        type: 'placeholder',
        sessionId: 's1',
        count: 5,
      })
    })

    it('should mark placeholder as isLast', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 0 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const placeholder = nodes.find(n => n.type === 'placeholder')!
      
      expect(placeholder.isLast).toBe(true)
    })

    it('should create single placeholder per unloaded session', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 10 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      const placeholders = nodes.filter(n => n.type === 'placeholder')
      
      expect(placeholders).toHaveLength(1)
    })
  })

  describe('tree structure', () => {
    it('should interleave sessions with their PTYs', () => {
      const sessions: SessionWithPtys[] = [
        { 
          session: createSession('s1'), 
          ptys: [createPty('pty-1')], 
          isActive: false, 
          ptyCount: 1 
        },
        { 
          session: createSession('s2'), 
          ptys: [createPty('pty-2'), createPty('pty-3')], 
          isActive: false, 
          ptyCount: 2 
        },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      
      expect(nodes.map(n => n.type)).toEqual(['session', 'pty', 'session', 'pty', 'pty'])
    })

    it('should handle mix of loaded and unloaded sessions', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 3 },
        { session: createSession('s2'), ptys: [createPty('pty-1')], isActive: true, ptyCount: 1 },
        { session: createSession('s3'), ptys: 'unloaded', isActive: false, ptyCount: 2 },
      ]
      
      const nodes = buildSessionTreeNodes(sessions)
      
      expect(nodes.map(n => n.type)).toEqual([
        'session', 'placeholder',
        'session', 'pty',
        'session', 'placeholder'
      ])
    })
  })

  describe('countTreeNodes', () => {
    it('should count all nodes including placeholders', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: true, isActive: false },
        { type: 'placeholder' as const, sessionId: 's1', isLast: true, count: 5 },
      ]
      
      expect(countTreeNodes(nodes)).toBe(2)
    })

    it('should count PTY nodes', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: true, isActive: false },
        { type: 'pty' as const, ptyId: 'p1', sessionId: 's1', isLast: false, ptyInfo: {} as PtyMetadata },
        { type: 'pty' as const, ptyId: 'p2', sessionId: 's1', isLast: true, ptyInfo: {} as PtyMetadata },
      ]
      
      expect(countTreeNodes(nodes)).toBe(3)
    })
  })

  describe('countTotalPtys', () => {
    it('should only count loaded PTYs, not placeholders', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 100 },
        { session: createSession('s2'), ptys: [createPty('pty-1'), createPty('pty-2')], isActive: false, ptyCount: 2 },
        { session: createSession('s3'), ptys: 'unloaded', isActive: false, ptyCount: 50 },
      ]
      
      expect(countTotalPtys(sessions)).toBe(2)
    })

    it('should return 0 for all unloaded sessions', () => {
      const sessions: SessionWithPtys[] = [
        { session: createSession('s1'), ptys: 'unloaded', isActive: false, ptyCount: 5 },
        { session: createSession('s2'), ptys: 'unloaded', isActive: false, ptyCount: 3 },
      ]
      
      expect(countTotalPtys(sessions)).toBe(0)
    })
  })

  describe('findPtyNode', () => {
    it('should find PTY by ID', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: false, isActive: false },
        { type: 'pty' as const, ptyId: 'pty-1', sessionId: 's1', isLast: false, ptyInfo: createPty('pty-1') },
        { type: 'pty' as const, ptyId: 'pty-2', sessionId: 's1', isLast: true, ptyInfo: createPty('pty-2') },
      ]
      
      const found = findPtyNode(nodes, 'pty-2')
      
      expect(found).toBeDefined()
      expect(found!.ptyId).toBe('pty-2')
      expect(found!.isLast).toBe(true)
    })

    it('should return undefined for non-existent PTY', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: true, isActive: false },
      ]
      
      const found = findPtyNode(nodes, 'non-existent')
      
      expect(found).toBeUndefined()
    })
  })

  describe('findSessionNode', () => {
    it('should find session by ID', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: false, isActive: false },
        { type: 'session' as const, sessionId: 's2', isLast: true, isActive: true },
      ]
      
      const found = findSessionNode(nodes, 's2')
      
      expect(found).toBeDefined()
      expect(found!.sessionId).toBe('s2')
      expect(found!.isActive).toBe(true)
    })

    it('should return undefined for non-existent session', () => {
      const nodes = [
        { type: 'session' as const, sessionId: 's1', isLast: true, isActive: false },
      ]
      
      const found = findSessionNode(nodes, 'non-existent')
      
      expect(found).toBeUndefined()
    })
  })
})
