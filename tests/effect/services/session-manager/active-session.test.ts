import { describe, expect, it, vi } from 'bun:test';

import type {
  SerializedSession,
  SessionIndex,
  SessionMetadata,
} from '../../../../src/effect/models';
import { switchToSession } from '../../../../src/effect/services/session-manager/active-session';
import type { SessionStorage } from '../../../../src/effect/services/SessionStorage';
import type { SessionId, WorkspaceId } from '../../../../src/effect/types';

const createMetadata = (id: string): SessionMetadata => ({
  id: id as SessionId,
  name: id,
  createdAt: 1,
  lastSwitchedAt: 1,
  autoNamed: false,
});

describe('active-session switchToSession', () => {
  it('does not block on session file metadata sync after updating the index', async () => {
    const metadata = createMetadata('session-1');
    const index: SessionIndex = {
      sessions: [metadata],
      activeSessionId: null,
      aggregateSessionOrder: [],
    };

    const session: SerializedSession = {
      metadata,
      workspaces: [],
      activeWorkspaceId: 1 as WorkspaceId,
    };

    const storage: SessionStorage = {
      loadIndex: async () => index,
      saveIndex: async () => undefined,
      loadSession: async () => session,
      saveSession: vi.fn(
        () =>
          new Promise<void>(() => {
            // Never resolves - switch should still finish.
          })
      ),
      deleteSession: async () => undefined,
      listSessions: async () => [metadata],
      sessionExists: async () => true,
    };

    let activeSessionId: SessionId | null = null;

    const result = await Promise.race([
      switchToSession(
        {
          storage,
          getActiveSessionId: () => activeSessionId,
          setActiveSessionId: (id) => {
            activeSessionId = id;
          },
        },
        'session-1' as SessionId
      ).then(() => 'resolved' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 25)),
    ]);

    expect(result).toBe('resolved');
    expect(activeSessionId).toBe('session-1');
    expect(storage.saveSession).toHaveBeenCalledTimes(1);
  });
});
