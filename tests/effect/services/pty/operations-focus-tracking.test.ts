import { describe, expect, test, vi } from "bun:test"
import { createOperations } from "../../../../src/effect/services/pty/operations"
import { createSubscriptionRegistry } from "../../../../src/effect/services/pty/subscription-manager"
import type { InternalPtySession } from "../../../../src/effect/services/pty/types"
import type { PtyId } from "../../../../src/effect/types"

function createSession(params: {
  id: PtyId
  shell: string
  focusTrackingEnabled: boolean
  focusTrackingOwnerProcess: string | null
  foregroundProcess: string | null
}) {
  const pty = {
    write: vi.fn(),
    getForegroundProcessName: vi.fn(() => params.foregroundProcess),
  }

  const session = {
    id: params.id,
    pty,
    shell: params.shell,
    focusTrackingEnabled: params.focusTrackingEnabled,
    focusState: false,
    focusTrackingOwnerProcess: params.focusTrackingOwnerProcess,
    scrollState: {
      viewportOffset: 0,
      lastScrollbackLength: 0,
      lastIsAtBottom: true,
    },
  } as unknown as InternalPtySession

  return { session, pty }
}

describe("createOperations sendFocusEvent", () => {
  test("resets stale focus tracking when shell regains foreground", async () => {
    const id = "pty-1" as PtyId
    const { session, pty } = createSession({
      id,
      shell: "/bin/zsh",
      focusTrackingEnabled: true,
      focusTrackingOwnerProcess: "kitten",
      foregroundProcess: "zsh",
    })

    const operations = createOperations({
      sessions: new Map([[id, session]]),
      lifecycleRegistry: createSubscriptionRegistry(),
    })

    await operations.sendFocusEvent(id, true)

    expect(session.focusTrackingEnabled).toBe(false)
    expect(session.focusTrackingOwnerProcess).toBeNull()
    expect(pty.write).not.toHaveBeenCalled()
  })

  test("keeps focus tracking when shell owns it", async () => {
    const id = "pty-2" as PtyId
    const { session, pty } = createSession({
      id,
      shell: "/bin/zsh",
      focusTrackingEnabled: true,
      focusTrackingOwnerProcess: "zsh",
      foregroundProcess: "zsh",
    })

    const operations = createOperations({
      sessions: new Map([[id, session]]),
      lifecycleRegistry: createSubscriptionRegistry(),
    })

    await operations.sendFocusEvent(id, false)

    expect(session.focusTrackingEnabled).toBe(true)
    expect(pty.write).toHaveBeenCalledWith("\x1b[O")
  })

  test("keeps focus tracking for the non-shell owner while it stays foreground", async () => {
    const id = "pty-3" as PtyId
    const { session, pty } = createSession({
      id,
      shell: "/bin/zsh",
      focusTrackingEnabled: true,
      focusTrackingOwnerProcess: "kitten",
      foregroundProcess: "kitten",
    })

    const operations = createOperations({
      sessions: new Map([[id, session]]),
      lifecycleRegistry: createSubscriptionRegistry(),
    })

    await operations.sendFocusEvent(id, true)

    expect(session.focusTrackingEnabled).toBe(true)
    expect(pty.write).toHaveBeenCalledWith("\x1b[I")
  })
})
