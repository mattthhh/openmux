/**
 * Test PTY Service Implementation
 * Mock PTY for testing purposes
 */
import type { TerminalState, UnifiedTerminalUpdate } from "../../../core/types"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"
import type { TerminalColors } from "../../../terminal/terminal-colors"
import { PtyNotFoundError } from "../../errors"
import type { PtyId, Cols, Rows } from "../../types"
import type { PtySession } from "../../models"
import { makePtyId } from "../../types"
import type { GitDiffStats, GitInfo } from "./helpers"
import type { PtyService } from "./interface"

/**
 * Create test PTY service - mock PTY for testing
 */
export function createTestPtyService(): PtyService {
  return {
    create: async () => makePtyId(),
    write: async () => undefined,
    sendFocusEvent: async () => undefined,
    resize: async () => undefined,
    getCwd: async () => "/test/cwd",
    destroy: async () => undefined,
    getSession: async (id) => ({
      id,
      pid: 12345,
      cols: 80 as Cols,
      rows: 24 as Rows,
      cwd: "/test/cwd",
      shell: "/bin/bash",
    }),
    getTerminalState: async () => ({
      cells: [],
      cursorX: 0,
      cursorY: 0,
      cursorVisible: true,
    } as unknown as TerminalState),
    subscribe: async () => () => {},
    subscribeToScroll: async () => () => {},
    subscribeUnified: async () => () => {},
    onExit: async () => () => {},
    getScrollState: async () => ({
      viewportOffset: 0,
      scrollbackLength: 0,
      isAtBottom: true,
    }),
    setScrollOffset: async () => undefined,
    setUpdateEnabled: async () => undefined,
    getEmulator: async () => {
      throw new Error("No emulator in test layer")
    },
    setHostColors: async () => undefined,
    destroyAll: async () => undefined,
    listAll: async () => [],
    getForegroundProcess: async () => undefined,
    getGitBranch: async () => undefined,
    getGitInfo: async () => undefined,
    getGitDiffStats: async () => undefined,
    subscribeToLifecycle: () => () => {},
    getTitle: async () => "",
    getLastCommand: async () => undefined,
    subscribeToTitleChange: async () => () => {},
    subscribeToAllTitleChanges: () => () => {},
    dispose: () => {
      // Test service doesn't need cleanup
    },
  }
}
