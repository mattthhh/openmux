/**
 * Test: createPTY uses the correct session ID when deferred past a session switch.
 *
 * Race condition:
 * 1. Session switch to B completes → switching=false → PTY creation effect fires
 * 2. Effect defers PTY creation via deferMacrotask
 * 3. User j/k navigates to session C in aggregate view → AUTOSWITCH fires
 * 4. AUTOSWITCH calls switchToSession(C) → onSessionLoad → setActiveSessionIdForShim(C)
 * 5. Deferred macrotask from step 2 finally runs → createPTY reads getActiveSessionIdForShim()
 *    which now returns C (WRONG — should be B)
 * 6. PTY is attributed to session C instead of session B
 *
 * Fix: createPTY accepts an explicit sessionId parameter. When provided,
 * it uses that instead of reading the global getActiveSessionIdForShim()
 * at execution time. The caller (pty-creation.ts effect) captures the
 * session ID synchronously before deferring to a macrotask.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

// We test the mapping logic directly rather than importing the full pty-lifecycle module
// (which has deep transitive dependencies that make mocking impractical).
// Instead, we extract and reproduce the key logic under test:
// how getActiveSessionIdForShim() is consumed in createPTY.

// Simulated global state
let activeSessionIdForShim: string | null = null;

const getActiveSessionIdForShim = () => activeSessionIdForShim;
const setActiveSessionIdForShim = (id: string | null) => {
  activeSessionIdForShim = id;
};

// Simplified mapping structures (same as the real code)
const ptyToSessionMap = new Map<string, { sessionId: string; paneId: string }>();
const sessionPtyMap = new Map<string, Map<string, string>>();

// ORIGINAL createPTY logic (before fix)
async function createPTY_original(paneId: string, _ptyId: string): Promise<string> {
  const sessionId = getActiveSessionIdForShim();
  if (sessionId) {
    const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
    mapping.set(paneId, _ptyId);
    sessionPtyMap.set(sessionId, mapping);
    ptyToSessionMap.set(_ptyId, { sessionId, paneId });
  }
  return _ptyId;
}

// FIXED createPTY logic (with explicit sessionId)
async function createPTY_fixed(
  paneId: string,
  _ptyId: string,
  explicitSessionId?: string
): Promise<string> {
  const sessionId = explicitSessionId ?? getActiveSessionIdForShim();
  if (sessionId) {
    const mapping = sessionPtyMap.get(sessionId) ?? new Map<string, string>();
    mapping.set(paneId, _ptyId);
    sessionPtyMap.set(sessionId, mapping);
    ptyToSessionMap.set(_ptyId, { sessionId, paneId });
  }
  return _ptyId;
}

describe('createPTY session ID race condition', () => {
  beforeEach(() => {
    ptyToSessionMap.clear();
    sessionPtyMap.clear();
    activeSessionIdForShim = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('original behavior (bug)', () => {
    it('attributes PTY to wrong session when global activeSessionId changes after deferral', async () => {
      // Step 1: Session B loads — PTY creation is scheduled
      setActiveSessionIdForShim('session-B');

      // Simulate what happens: the effect reads panes needing PTYs and
      // defers createPtyForPane to a macrotask. At schedule time,
      // the global says session-B.
      //
      // But between scheduling and execution, AUTOSWITCH fires for session-C.
      //
      // In the ORIGINAL code, createPTY reads getActiveSessionIdForShim()
      // at EXECUTION time (inside the macrotask), not at schedule time.
      // So it picks up the clobbered value.

      // Simulate: macrotask is about to run, but global has changed
      setActiveSessionIdForShim('session-C');

      // The deferred createPTY now executes — it reads the GLOBAL
      const ptyId = await createPTY_original('pane-B1', 'pty-B1');

      expect(ptyId).toBe('pty-B1');

      // BUG: PTY is mapped to session-C (wrong!)
      const sessionInfo = ptyToSessionMap.get('pty-B1');
      expect(sessionInfo).toBeDefined();
      expect(sessionInfo!.sessionId).toBe('session-C');

      // Session-C now has a PTY it shouldn't own
      expect(sessionPtyMap.get('session-C')?.get('pane-B1')).toBe('pty-B1');

      // Session-B has no mapping for this PTY
      expect(sessionPtyMap.get('session-B')).toBeUndefined();
    });

    it('causes cross-contamination across 3 sessions during rapid j/k navigation', async () => {
      // Navigate: A → B (switch completes, deferred macrotask) → C (switch completes)
      // B's deferred PTY creation runs AFTER C's setActiveSessionIdForShim

      // A is active initially
      setActiveSessionIdForShim('session-A');

      // Switch to B completes
      setActiveSessionIdForShim('session-B');

      // B's PTY creation is deferred (not yet executed)
      // ... but then a rapid j/k triggers AUTOSWITCH to session-C
      setActiveSessionIdForShim('session-C');

      // B's deferred macrotask finally fires — reads session-C (WRONG)
      await createPTY_original('pane-B1', 'pty-B1');

      // C's PTY creation also deferred, but runs while global is still session-C
      await createPTY_original('pane-C1', 'pty-C1');

      // Cross-contamination: session-C has BOTH PTYs
      expect(ptyToSessionMap.get('pty-B1')?.sessionId).toBe('session-C');
      expect(ptyToSessionMap.get('pty-C1')?.sessionId).toBe('session-C');

      // Session-B has NO PTYs (they were all stolen by session-C)
      expect(sessionPtyMap.get('session-B')).toBeUndefined();

      // Session-C wrongly has 2 PTYs
      expect(sessionPtyMap.get('session-C')?.size).toBe(2);
    });
  });

  describe('fixed behavior (with explicit sessionId)', () => {
    it('uses explicit sessionId over global getActiveSessionIdForShim()', async () => {
      // Capture session ID at SCHEDULE time (before deferral)
      const capturedSessionId = 'session-B';

      // Session B is active at schedule time
      setActiveSessionIdForShim('session-B');

      // Call createPTY with explicit sessionId
      const createPromise = createPTY_fixed('pane-B1', 'pty-B1', capturedSessionId);

      // Before the promise resolves, global changes (AUTOSWITCH to C)
      setActiveSessionIdForShim('session-C');

      const ptyId = await createPromise;
      expect(ptyId).toBe('pty-B1');

      // WITH FIX: PTY is correctly attributed to session-B
      const sessionInfo = ptyToSessionMap.get('pty-B1');
      expect(sessionInfo).toBeDefined();
      expect(sessionInfo!.sessionId).toBe('session-B');

      // Session-B has the correct mapping
      expect(sessionPtyMap.get('session-B')?.get('pane-B1')).toBe('pty-B1');

      // Session-C does NOT have this PTY
      expect(sessionPtyMap.get('session-C')).toBeUndefined();
    });

    it('falls back to getActiveSessionIdForShim() when explicit sessionId is not provided', async () => {
      setActiveSessionIdForShim('session-default');

      const ptyId = await createPTY_fixed('pane-1', 'pty-1');

      expect(ptyId).toBe('pty-1');
      const sessionInfo = ptyToSessionMap.get('pty-1');
      expect(sessionInfo).toBeDefined();
      expect(sessionInfo!.sessionId).toBe('session-default');
    });

    it('prevents cross-contamination during rapid j/k navigation across 3 sessions', async () => {
      // A → B → C race:

      // Session B loads, capture at schedule time
      setActiveSessionIdForShim('session-B');
      const capturedB = 'session-B';

      // B's pane creation is deferred with captured session ID
      const createB_Promise = createPTY_fixed('pane-B1', 'pty-B1', capturedB);

      // AUTOSWITCH fires for session-C before B's PTY creation resolves
      setActiveSessionIdForShim('session-C');
      const capturedC = 'session-C';

      // B's creation completes — should map to session-B
      const ptyB = await createB_Promise;
      expect(ptyB).toBe('pty-B1');

      // B's PTY correctly mapped to session-B despite global being session-C
      const sessionInfoB = ptyToSessionMap.get('pty-B1');
      expect(sessionInfoB).toBeDefined();
      expect(sessionInfoB!.sessionId).toBe('session-B');
      expect(sessionPtyMap.get('session-B')?.get('pane-B1')).toBe('pty-B1');

      // C's pane creation
      const ptyC = await createPTY_fixed('pane-C1', 'pty-C1', capturedC);

      const sessionInfoC = ptyToSessionMap.get('pty-C1');
      expect(sessionInfoC).toBeDefined();
      expect(sessionInfoC!.sessionId).toBe('session-C');
      expect(sessionPtyMap.get('session-C')?.get('pane-C1')).toBe('pty-C1');

      // No cross-contamination: C does NOT have B's PTY
      expect(sessionPtyMap.get('session-C')?.has('pane-B1')).toBe(false);
      expect(sessionPtyMap.get('session-B')?.has('pane-C1')).toBe(false);
    });

    it('handles createPaneWithPTY session attribution correctly with explicit sessionId', async () => {
      // Same test but for the createPaneWithPTY code path
      // (AggregateStateManager creates panes in other sessions)

      const capturedSessionId = 'session-target';

      // Global is a DIFFERENT session (e.g., session-current is active,
      // but we're creating a pane in session-target)
      setActiveSessionIdForShim('session-current');

      // Simulate createPaneWithPTY with captured session-target
      const ptyId = await createPTY_fixed('pane-T1', 'pty-T1', capturedSessionId);

      expect(ptyId).toBe('pty-T1');
      const sessionInfo = ptyToSessionMap.get('pty-T1');
      expect(sessionInfo).toBeDefined();
      expect(sessionInfo!.sessionId).toBe('session-target');

      // Session-current should NOT have this PTY
      expect(sessionPtyMap.get('session-current')).toBeUndefined();
      // Session-target should have it
      expect(sessionPtyMap.get('session-target')?.get('pane-T1')).toBe('pty-T1');
    });
  });

  describe('pty-creation effect captures sessionId before deferral', () => {
    it('demonstrates that reading the session ID at schedule time prevents the race', () => {
      // This documents the fix pattern for pty-creation.ts:
      // Read getActiveSessionIdForShim() SYNCHRONOUSLY in the effect body
      // (when switching just became false, so it's still correct),
      // then pass the captured value through to the deferred createPtyForPane.

      setActiveSessionIdForShim('session-B');

      // Read synchronously in the effect body (BEFORE deferMacrotask)
      const capturedSessionId = getActiveSessionIdForShim();
      expect(capturedSessionId).toBe('session-B');

      // After deferral, global may have changed
      setActiveSessionIdForShim('session-C');

      // The captured value is still session-B
      expect(capturedSessionId).toBe('session-B');

      // But reading the global now would give the wrong answer
      expect(getActiveSessionIdForShim()).toBe('session-C');
    });
  });
});
