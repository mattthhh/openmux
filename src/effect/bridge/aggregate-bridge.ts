/**
 * Aggregate view bridge functions (errore version)
 * Provides PTY listing with metadata for aggregate view
 * 
 * Directly uses PtyService interface without Effect runtime.
 * Backward-compatible versions use the global services singleton.
 */

import type { PtyService } from "../services/Pty"
import type { SessionManager } from "../services/SessionManager"
import type { PtyId, SessionId, Cols, Rows } from "../types"
import type { SessionMetadata, SerializedSession, SerializedLayoutNode } from "../models"
import type { GitDiffStats, GitInfo } from "../services/pty/helpers"
import { getSessionPtyMapping, registerPtyPane, type SessionPtyMapping } from "./shim-bridge"
import { getPtyService, getSessionManager, hasServices } from "./services-instance"

/** PTY metadata for aggregate view */
export interface PtyMetadata {
  ptyId: string
  cwd: string
  gitBranch: string | undefined
  gitDiffStats: GitDiffStats | undefined
  gitDirty: boolean
  gitStaged: number
  gitUnstaged: number
  gitUntracked: number
  gitConflicted: number
  gitAhead: number | undefined
  gitBehind: number | undefined
  gitStashCount: number | undefined
  gitState: GitInfo["state"] | undefined
  gitDetached: boolean
  gitRepoKey: string | undefined
  foregroundProcess: string | undefined
  shell: string | undefined
  title: string | undefined
  workspaceId: number | undefined
  paneId: string | undefined
}

interface FetchPtyMetadataOptions {
  skipGitDiffStats?: boolean
}

// =============================================================================
// Session-Aware PTY Types
// =============================================================================

/** Represents a session with its associated PTYs for tree view */
export interface SessionWithPtys {
  /** Session metadata (always available) */
  session: SessionMetadata
  /** 
   * PTYs in this session:
   * - PtyMetadata[] if session is loaded
   * - 'unloaded' if session is not loaded (lazy-load on demand)
   */
  ptys: PtyMetadata[] | 'unloaded'
  /** Whether this session is currently active */
  isActive: boolean
  /** Number of PTYs in the session (cached for unloaded sessions) */
  ptyCount: number
}

/** Tree node type for visual rendering (compatible with aggregate-view-types.ts) */
export type VisualTreeNode =
  | { type: 'session'; sessionId: string; isLast: boolean; isActive: boolean }
  | { type: 'pty'; ptyId: string; sessionId: string; isLast: boolean; ptyInfo: PtyMetadata }
  | { type: 'placeholder'; sessionId: string; isLast: boolean; count: number }

/** Options for listing sessions with PTYs */
export interface ListSessionsWithPtysOptions {
  /** Skip expensive git diff stats (useful for polling) */
  skipGitDiffStats?: boolean
  /** Maximum concurrent PTY metadata fetches */
  batchSize?: number
}

// =============================================================================
// Session-PTY Cache
// =============================================================================

/** Cache entry for session-PTY mapping */
interface SessionPtyCacheEntry {
  /** Session ID */
  sessionId: SessionId
  /** PTY IDs in this session */
  ptyIds: Set<PtyId>
  /** Last updated timestamp */
  lastUpdated: number
  /** Whether this session is currently loaded */
  isLoaded: boolean
}

/** Simple in-memory cache for session→PTY mappings */
class SessionPtyCache {
  private cache = new Map<SessionId, SessionPtyCacheEntry>()
  private ptyToSession = new Map<PtyId, SessionId>()
  private maxAgeMs: number

  constructor(maxAgeMs = 30000) {
    this.maxAgeMs = maxAgeMs
  }

  /** Get cached entry for a session */
  get(sessionId: SessionId): SessionPtyCacheEntry | undefined {
    const entry = this.cache.get(sessionId)
    if (!entry) return undefined
    
    // Check expiration
    if (Date.now() - entry.lastUpdated > this.maxAgeMs) {
      this.delete(sessionId)
      return undefined
    }
    
    return entry
  }

  /** Set cache entry for a session */
  set(sessionId: SessionId, ptyIds: PtyId[], isLoaded: boolean): void {
    // Remove old mappings
    const oldEntry = this.cache.get(sessionId)
    if (oldEntry) {
      for (const ptyId of oldEntry.ptyIds) {
        this.ptyToSession.delete(ptyId)
      }
    }

    // Add new mappings
    const newEntry: SessionPtyCacheEntry = {
      sessionId,
      ptyIds: new Set(ptyIds),
      lastUpdated: Date.now(),
      isLoaded,
    }
    
    this.cache.set(sessionId, newEntry)
    for (const ptyId of ptyIds) {
      this.ptyToSession.set(ptyId, sessionId)
    }
  }

  /** Get session ID for a PTY */
  getSessionForPty(ptyId: PtyId): SessionId | undefined {
    return this.ptyToSession.get(ptyId)
  }

  /** Delete cache entry */
  delete(sessionId: SessionId): void {
    const entry = this.cache.get(sessionId)
    if (entry) {
      for (const ptyId of entry.ptyIds) {
        this.ptyToSession.delete(ptyId)
      }
      this.cache.delete(sessionId)
    }
  }

  /** Clear all cached entries */
  clear(): void {
    this.cache.clear()
    this.ptyToSession.clear()
  }

  /** Get all cached session IDs */
  keys(): IterableIterator<SessionId> {
    return this.cache.keys()
  }
}

/** Global cache instance */
const sessionPtyCache = new SessionPtyCache()

/** Aggregate-local session pane↔PTY mappings for background-loaded sessions */
const aggregateSessionMappings = new Map<string, Map<string, string>>()

/** Helper to convert string to PtyId branded type */
const asPtyId = (id: string): PtyId => id as PtyId

/** Find the workspace ID containing a pane ID in serialized session data */
function findWorkspaceIdForPane(session: SerializedSession, paneId: string): number | undefined {
  const containsPane = (node: SerializedLayoutNode | null | undefined): boolean => {
    if (!node) return false
    if ('type' in node && node.type === 'split') {
      return containsPane(node.first) || containsPane(node.second)
    }
    return node.id === paneId
  }

  for (const workspace of session.workspaces) {
    if (containsPane(workspace.mainPane)) {
      return workspace.id
    }
    for (const pane of workspace.stackPanes) {
      if (containsPane(pane)) {
        return workspace.id
      }
    }
  }

  return undefined
}

function collectPaneRecords(
  node: SerializedLayoutNode | null | undefined,
  result: Array<{ paneId: string; cwd: string }>
): void {
  if (!node) return
  if ('type' in node && node.type === 'split') {
    collectPaneRecords(node.first, result)
    collectPaneRecords(node.second, result)
    return
  }
  const pane = node as { id: string; cwd: string }
  result.push({ paneId: pane.id, cwd: pane.cwd })
}

function getActiveWorkspacePaneRecords(session: SerializedSession): Array<{ paneId: string; cwd: string }> {
  const workspace = session.workspaces.find((candidate) => candidate.id === session.activeWorkspaceId)
  if (!workspace) return []

  const result: Array<{ paneId: string; cwd: string }> = []
  collectPaneRecords(workspace.mainPane, result)
  for (const pane of workspace.stackPanes) {
    collectPaneRecords(pane, result)
  }
  return result
}

async function getStoredSessionPtyMapping(sessionId: string): Promise<SessionPtyMapping | undefined> {
  const shimMapping = await getSessionPtyMapping(sessionId)
  const localMapping = aggregateSessionMappings.get(sessionId)

  if (!shimMapping && !localMapping) {
    return undefined
  }

  const mergedMapping = new Map(shimMapping?.mapping ?? [])
  if (localMapping) {
    for (const [paneId, ptyId] of localMapping) {
      mergedMapping.set(paneId, ptyId)
    }
  }

  return {
    mapping: mergedMapping,
    stalePaneIds: shimMapping?.stalePaneIds ?? [],
  }
}

function setStoredSessionPtyMapping(sessionId: string, mapping: Map<string, string>): void {
  aggregateSessionMappings.set(sessionId, new Map(mapping))
}

export async function getAggregateSessionPtyMapping(sessionId: string): Promise<SessionPtyMapping | undefined> {
  return getStoredSessionPtyMapping(sessionId)
}

/**
 * Batch fetch PTY metadata with concurrency limiting.
 * Uses async streaming pattern to avoid blocking.
 */
async function* batchFetchPtyMetadata(
  pty: PtyService,
  ptyIds: PtyId[],
  options: FetchPtyMetadataOptions = {},
  batchSize = 8
): AsyncGenerator<PtyMetadata, void, unknown> {
  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < ptyIds.length; i += batchSize) {
    const batch = ptyIds.slice(i, i + batchSize)
    
    // Fetch batch in parallel
    const results = await Promise.all(
      batch.map(id => fetchPtyMetadata(pty, id, options))
    )
    
    // Yield valid results as they complete
    for (const result of results) {
      if (result !== null) {
        yield result
      }
    }
  }
}

/**
 * Fetch metadata for a single PTY.
 * Returns null if PTY is invalid or defunct.
 */
async function fetchPtyMetadata(
  pty: PtyService,
  ptyId: PtyId,
  options: FetchPtyMetadataOptions = {}
): Promise<PtyMetadata | null> {
  try {
    // Get session - trust Pty service for validity
    const session = await pty.getSession(ptyId)
    if (session instanceof Error || session.pid === 0) {
      return null
    }

    // Fetch cwd, git info, foregroundProcess in parallel
    const [cwdResult, gitInfoResult, foregroundProcessResult] = await Promise.all([
      pty.getCwd(ptyId),
      pty.getGitInfo(ptyId).catch(() => undefined),
      pty.getForegroundProcess(ptyId).catch(() => undefined),
    ])

    const cwd = cwdResult instanceof Error ? process.cwd() : cwdResult
    const gitInfo = gitInfoResult instanceof Error ? undefined : gitInfoResult
    const foregroundProcess = foregroundProcessResult instanceof Error ? undefined : foregroundProcessResult

    // Skip defunct processes (zombie processes)
    if (foregroundProcess?.includes('defunct')) {
      return null
    }

    // Fetch git diff stats (only if we have a cwd and not skipped)
    const gitDiffStats = options.skipGitDiffStats
      ? undefined
      : await pty.getGitDiffStats(ptyId).catch(() => undefined)

    const gitInfoValue = gitInfo as GitInfo | undefined

    return {
      ptyId,
      cwd,
      gitBranch: gitInfoValue?.branch,
      gitDiffStats: gitDiffStats instanceof Error ? undefined : gitDiffStats,
      gitDirty: gitInfoValue?.dirty ?? false,
      gitStaged: gitInfoValue?.staged ?? 0,
      gitUnstaged: gitInfoValue?.unstaged ?? 0,
      gitUntracked: gitInfoValue?.untracked ?? 0,
      gitConflicted: gitInfoValue?.conflicted ?? 0,
      gitAhead: gitInfoValue?.ahead,
      gitBehind: gitInfoValue?.behind,
      gitStashCount: gitInfoValue?.stashCount,
      gitState: gitInfoValue?.state,
      gitDetached: gitInfoValue?.detached ?? false,
      gitRepoKey: gitInfoValue?.repoKey,
      foregroundProcess,
      shell: session.shell,
      title: undefined, // Title is set dynamically via title change events
      workspaceId: undefined, // Will be enriched by AggregateView
      paneId: undefined,      // Will be enriched by AggregateView
    }
  } catch {
    return null
  }
}

export interface ListAllPtysOptions {
  /** Skip fetching git diff stats (useful for polling to reduce overhead) */
  skipGitDiffStats?: boolean
}

/**
 * List all sessions with their PTYs for the aggregate view.
 * 
 * - Returns session metadata immediately (fast)
 * - For active/loaded sessions: fetches full PTY metadata
 * - For unloaded sessions: returns 'unloaded' placeholder
 * - Uses async streaming to avoid blocking
 * - Caches session→PTY mappings for performance
 * 
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @param options.batchSize - Max concurrent PTY fetches (default: 8)
 * @returns Array of sessions with their PTY info
 */
export async function listSessionsWithPtys(
  options: ListSessionsWithPtysOptions = {}
): Promise<SessionWithPtys[]> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot list sessions with PTYs")
    return []
  }
  return listSessionsWithPtysWithService(
    getPtyService(),
    getSessionManager(),
    options
  )
}

/**
 * List all sessions with their PTYs using explicit services.
 * 
 * @param pty - The PTY service
 * @param sessionManager - The session manager service
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @param options.batchSize - Max concurrent PTY fetches (default: 8)
 * @returns Array of sessions with their PTY info
 */
export async function listSessionsWithPtysWithService(
  pty: PtyService,
  sessionManager: SessionManager,
  options: ListSessionsWithPtysOptions = {}
): Promise<SessionWithPtys[]> {
  const { skipGitDiffStats, batchSize = 8 } = options

  // Step 1: Get all session metadata (fast, non-blocking)
  const sessionsResult = await sessionManager.listSessions()
  if (sessionsResult instanceof Error) {
    console.warn("Failed to list sessions:", sessionsResult)
    return []
  }
  const sessions = [...sessionsResult]
  
  // Step 2: Get active session ID
  const activeSessionId = sessionManager.getActiveSessionId()

  // Step 3: Get all active PTY IDs from PTY service (fast)
  const allActivePtyIds = await pty.listAll()
  const activePtyIdSet = new Set(allActivePtyIds.map(id => String(id)))

  // Step 4: Build session list with async PTY fetching
  const result: SessionWithPtys[] = []
  const pendingLoads: Promise<void>[] = []

  console.log(`[listSessionsWithPtys] Starting loop for ${sessions.length} sessions, active: ${activeSessionId}, activePTYs: ${allActivePtyIds.length}`)
  
  for (const session of sessions) {
    const isActive = session.id === activeSessionId
    const cached = sessionPtyCache.get(session.id)
    
    console.log(`[listSessionsWithPtys] Session: ${session.name} (${session.id}), isActive: ${isActive}, cached: ${cached ? `loaded=${cached.isLoaded}, ptys=${cached.ptyIds.size}` : 'null'}`)

    // If we have cached data, use it
    if (cached && cached.isLoaded) {
      // Filter to only active PTYs
      const activePtyIdsInSession = [...cached.ptyIds].filter(id => activePtyIdSet.has(String(id)))
      
      if (activePtyIdsInSession.length === 0 && !isActive) {
        // Session has no active PTYs and is not active - treat as unloaded
        result.push({
          session,
          ptys: 'unloaded',
          isActive: false,
          ptyCount: cached.ptyIds.size,
        })
      } else {
        // Fetch PTY metadata asynchronously
        const ptys: PtyMetadata[] = []
        
        // Start async fetch but don't block
        const loadPromise = (async () => {
          try {
            for await (const metadata of batchFetchPtyMetadata(
              pty,
              activePtyIdsInSession,
              { skipGitDiffStats },
              batchSize
            )) {
              // Attach session metadata to each PTY
              (metadata as unknown as Record<string, unknown>).sessionId = session.id
              ;(metadata as unknown as Record<string, unknown>).sessionMetadata = session
              ptys.push(metadata)
            }
          } catch (e) {
            console.warn(`Failed to fetch PTYs for session ${session.id}:`, e)
          }
        })()
        
        pendingLoads.push(loadPromise)
        
        result.push({
          session,
          ptys,
          isActive,
          ptyCount: activePtyIdsInSession.length,
        })
      }
      continue
    }

    // No cache - need to determine if session is loaded
    if (isActive) {
      // Active session: all active PTYs belong to this session
      const ptys: PtyMetadata[] = []
      
      // For active session, use all active PTY IDs
      // (The active session owns all currently running PTYs)
      const activeSessionPtyIds = [...activePtyIdSet]
      console.log(`[listSessionsWithPtys] Active session ${session.id} using ${activeSessionPtyIds.length} active PTYs:`, activeSessionPtyIds)
      
      // Fetch metadata for all active PTYs
      const loadPromise = (async () => {
        try {
          for await (const metadata of batchFetchPtyMetadata(
            pty,
            activeSessionPtyIds.map(id => asPtyId(id)),
            { skipGitDiffStats },
            batchSize
          )) {
            // Attach session metadata to each PTY
            (metadata as unknown as Record<string, unknown>).sessionId = session.id
            ;(metadata as unknown as Record<string, unknown>).sessionMetadata = session
            ptys.push(metadata)
          }
          console.log(`[listSessionsWithPtys] Loaded ${ptys.length} PTYs for active session ${session.id}`)
          
          // Update cache with actual PTY IDs (not pane IDs)
          sessionPtyCache.set(session.id, activeSessionPtyIds.map(id => asPtyId(id)), true)
        } catch (e) {
          console.warn(`[listSessionsWithPtys] Failed to load PTYs for active session ${session.id}:`, e)
        }
      })()
      
      pendingLoads.push(loadPromise)
      
      result.push({
        session,
        ptys,
        isActive: true,
        ptyCount: activeSessionPtyIds.length,
      })
    } else {
      // Inactive session: try to get summary or use placeholder
      const summaryResult = await sessionManager.getSessionSummary(session.id)
      const ptyCount = (summaryResult instanceof Error || summaryResult === null) 
        ? 0 
        : summaryResult.paneCount
      
      result.push({
        session,
        ptys: 'unloaded',
        isActive: false,
        ptyCount,
      })
    }
  }

  // Wait for all async loads to complete
  await Promise.all(pendingLoads)
  
  // Update ptyCount for active sessions after load
  for (const item of result) {
    if (Array.isArray(item.ptys)) {
      item.ptyCount = item.ptys.length
    }
  }

  return result
}

/**
 * Load a specific session's PTYs on demand.
 * Useful for lazy-loading unloaded sessions in the tree view.
 * 
 * @param sessionId - The session ID to load
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns The loaded PTY metadata or null if session not found
 */
export async function loadSessionPtys(
  sessionId: string,
  options: { skipGitDiffStats?: boolean } = {}
): Promise<PtyMetadata[] | null> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot load session PTYs")
    return null
  }
  return loadSessionPtysWithService(
    getPtyService(),
    getSessionManager(),
    sessionId,
    options
  )
}

/**
 * Load a specific session's PTYs with explicit services.
 * 
 * @param pty - The PTY service
 * @param sessionManager - The session manager service
 * @param sessionId - The session ID to load
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns The loaded PTY metadata or null if session not found
 */
export async function loadSessionPtysWithService(
  pty: PtyService,
  sessionManager: SessionManager,
  sessionId: string,
  options: { skipGitDiffStats?: boolean } = {}
): Promise<PtyMetadata[] | null> {
  const sessionData = await sessionManager.loadSession(sessionId as SessionId)
  if (sessionData instanceof Error) {
    return null
  }

  const storedMapping = await getStoredSessionPtyMapping(sessionId)
  const paneToPtyMap = storedMapping?.mapping ?? new Map<string, string>()
  const paneIdByPtyId = new Map<string, string>()

  let activeSessionPtyIds: PtyId[] = []

  if (paneToPtyMap.size > 0) {
    activeSessionPtyIds = [...paneToPtyMap.values()].map((ptyId) => asPtyId(ptyId))
    for (const [paneId, ptyId] of paneToPtyMap) {
      paneIdByPtyId.set(ptyId, paneId)
    }
  }

  const ptys: PtyMetadata[] = []
  for await (const metadata of batchFetchPtyMetadata(
    pty,
    activeSessionPtyIds,
    { skipGitDiffStats: options.skipGitDiffStats },
    8
  )) {
    const paneId = paneIdByPtyId.get(metadata.ptyId)
    if (paneId) {
      metadata.paneId = paneId
      metadata.workspaceId = findWorkspaceIdForPane(sessionData, paneId)
    }
    ptys.push(metadata)
  }

  sessionPtyCache.set(sessionId as SessionId, activeSessionPtyIds, true)

  return ptys
}

/**
 * Build a flattened tree representation for navigation.
 * Creates visual tree structure with proper prefixes.
 * 
 * @param sessions - Sessions with PTYs from listSessionsWithPtys
 * @returns Flattened array of tree nodes in visual order
 */
export function buildSessionTreeNodes(
  sessions: SessionWithPtys[]
): VisualTreeNode[] {
  const nodes: VisualTreeNode[] = []
  const sessionCount = sessions.length

  for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
    const sessionItem = sessions[sessionIndex]
    const isLastSession = sessionIndex === sessionCount - 1

    // Add session node
    nodes.push({
      type: 'session',
      sessionId: sessionItem.session.id,
      isLast: isLastSession,
      isActive: sessionItem.isActive,
    })

    // Add PTY nodes or placeholder
    if (sessionItem.ptys === 'unloaded') {
      nodes.push({
        type: 'placeholder',
        sessionId: sessionItem.session.id,
        isLast: true,
        count: sessionItem.ptyCount,
      })
    } else {
      const ptyCount = sessionItem.ptys.length
      for (let ptyIndex = 0; ptyIndex < ptyCount; ptyIndex++) {
        const ptyMeta = sessionItem.ptys[ptyIndex]
        const isLastPty = ptyIndex === ptyCount - 1

        nodes.push({
          type: 'pty',
          ptyId: ptyMeta.ptyId,
          sessionId: sessionItem.session.id,
          isLast: isLastPty,
          ptyInfo: ptyMeta,
        })
      }
    }
  }

  return nodes
}

/**
 * Clear the session→PTY cache.
 * Call this when sessions are deleted or major state changes occur.
 */
export function clearSessionPtyCache(): void {
  sessionPtyCache.clear()
  aggregateSessionMappings.clear()
}

/**
 * Invalidate cache for a specific session.
 * Call this when a session's PTYs change.
 */
export function invalidateSessionCache(sessionId: string): void {
  sessionPtyCache.delete(sessionId as SessionId)
  aggregateSessionMappings.delete(sessionId)
}

/**
 * Fetch metadata for a single PTY by ID.
 * Useful for staggered polling to avoid subprocess burst.
 * 
 * Backward-compatible version that uses global services singleton.
 *
 * @param ptyId - The PTY ID to fetch metadata for
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns PTY metadata or null if PTY is invalid/defunct
 */
export async function getPtyMetadata(
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot fetch PTY metadata")
    return null
  }
  return getPtyMetadataWithService(getPtyService(), ptyId, options)
}

/**
 * List all PTYs with their metadata.
 * Fetches metadata in parallel for better performance.
 * 
 * Backward-compatible version that uses global services singleton.
 *
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtysWithMetadata(
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[]> {
  if (!hasServices()) {
    console.warn("Services not initialized, cannot list PTYs")
    return []
  }
  return listAllPtysWithMetadataWithService(getPtyService(), options)
}

/**
 * Fetch metadata for a single PTY by ID with explicit service.
 * Useful for staggered polling to avoid subprocess burst.
 *
 * @param pty - The PTY service
 * @param ptyId - The PTY ID to fetch metadata for
 * @param options.skipGitDiffStats - Skip expensive git diff stats
 * @returns PTY metadata or null if PTY is invalid/defunct
 */
export async function getPtyMetadataWithService(
  pty: PtyService,
  ptyId: string,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata | null> {
  return fetchPtyMetadata(pty, asPtyId(ptyId), {
    skipGitDiffStats: options.skipGitDiffStats,
  })
}

/**
 * List all PTYs with their metadata with explicit service.
 * Fetches metadata in parallel for better performance.
 *
 * @param pty - The PTY service
 * @param options.skipGitDiffStats - Skip expensive git diff stats during polling
 */
export async function listAllPtysWithMetadataWithService(
  pty: PtyService,
  options: ListAllPtysOptions = {}
): Promise<PtyMetadata[]> {
  try {
    const ptyIds = await pty.listAll()

    // Fetch all PTY metadata in parallel
    const results = await Promise.all(
      ptyIds.map((id) => fetchPtyMetadata(pty, id, { skipGitDiffStats: options.skipGitDiffStats }))
    )

    // Filter out null values
    return results.filter((meta): meta is PtyMetadata => meta !== null)
  } catch {
    return []
  }
}

// =============================================================================
// Lazy Loading: Load Session PTYs on Demand
// =============================================================================

/** Result of loading a session's PTYs */
export interface LoadSessionPtysResult {
  /** Session ID that was loaded */
  sessionId: string
  /** PTYs in the session (empty if error) */
  ptys: PtyMetadata[]
  /** Error message if loading failed */
  error: string | null
  /** Last active workspace ID from session data */
  lastActiveWorkspaceId: number | undefined
}

/**
 * Load PTYs for a specific session on demand (lazy loading).
 * This does NOT block the current session - it's an async fetch.
 * 
 * @param sessionId - The session ID to load PTYs for
 * @returns Load result with PTYs or error
 */
export async function loadSessionPtysOnDemand(
  sessionId: string
): Promise<LoadSessionPtysResult> {
  const ptyService = getPtyService()
  const sessionManager = getSessionManager()

  const sessionResult = await sessionManager.loadSession(sessionId as SessionId)
  if (sessionResult instanceof Error) {
    return {
      sessionId,
      ptys: [],
      error: 'Failed to load session',
      lastActiveWorkspaceId: undefined,
    }
  }

  let ptys = await loadSessionPtysWithService(
    ptyService,
    sessionManager,
    sessionId,
    { skipGitDiffStats: true }
  )

  if ((ptys?.length ?? 0) === 0) {
    const paneRecords = getActiveWorkspacePaneRecords(sessionResult)
    const existingMapping = await getStoredSessionPtyMapping(sessionId)
    const nextMapping = new Map(existingMapping?.mapping ?? [])

    for (const { paneId, cwd } of paneRecords) {
      if (nextMapping.has(paneId)) {
        continue
      }

      const created = await ptyService.create({
        cols: 80 as Cols,
        rows: 24 as Rows,
        cwd,
      })
      if (created instanceof Error) {
        continue
      }

      const ptyId = String(created)
      nextMapping.set(paneId, ptyId)
      setStoredSessionPtyMapping(sessionId, nextMapping)
      await registerPtyPane(sessionId, paneId, ptyId).catch(() => {})
    }

    ptys = await loadSessionPtysWithService(
      ptyService,
      sessionManager,
      sessionId,
      { skipGitDiffStats: true }
    )
  }

  return {
    sessionId,
    ptys: ptys ?? [],
    error: ptys === null ? 'Failed to load session' : null,
    lastActiveWorkspaceId: sessionResult.activeWorkspaceId,
  }
}
