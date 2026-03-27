/**
 * Test PTY Service Implementation
 * Mock PTY for testing purposes
 */
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import { PtyNotFoundError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import type { PtySession } from '../../models';
import { makePtyId } from '../../types';
import type { GitDiffStats, GitInfo } from './helpers';
import type { PtyService } from './interface';

/**
 * Create test PTY service - mock PTY for testing
 */
export function createTestPtyService(): PtyService {
  // Track created and destroyed PTY IDs for testing
  const ptyIds = new Set<PtyId>();
  const destroyedPtyIds = new Set<PtyId>();

  return {
    create: async () => {
      const id = makePtyId();
      ptyIds.add(id);
      destroyedPtyIds.delete(id); // Re-enable if previously destroyed
      return id;
    },
    write: async () => undefined,
    sendFocusEvent: async () => undefined,
    resize: async () => undefined,
    getCwd: async () => '/test/cwd',
    destroy: async (id: PtyId) => {
      ptyIds.delete(id);
      destroyedPtyIds.add(id);
      return undefined;
    },
    getSession: async (id: PtyId) => {
      // Return error for destroyed PTYs
      if (destroyedPtyIds.has(id)) {
        return new PtyNotFoundError({ ptyId: id });
      }
      // Return error for IDs that don't look like valid PTY IDs
      // Valid PTY IDs start with 'pty-' and follow the format from makePtyId()
      const idStr = String(id);
      const isValidFormat = idStr.startsWith('pty-') || ptyIds.has(id);
      if (!isValidFormat) {
        return new PtyNotFoundError({ ptyId: id });
      }
      // Return session for valid IDs
      return {
        id,
        pid: 12345,
        cols: 80 as Cols,
        rows: 24 as Rows,
        cwd: '/test/cwd',
        shell: '/bin/bash',
      };
    },
    getTerminalState: async () =>
      ({
        cells: [],
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
      }) as unknown as TerminalState,
    subscribe: async (id: PtyId, callback: (state: TerminalState) => void) => {
      // Provide initial state immediately
      callback({
        cells: [],
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
      } as unknown as TerminalState);
      return () => {};
    },
    subscribeToScroll: async () => () => {},
    subscribeUnified: async (id: PtyId, callback: (update: UnifiedTerminalUpdate) => void) => {
      // Provide initial update immediately
      callback({
        terminalUpdate: {
          dirtyRows: new Map(),
          cursor: { x: 0, y: 0, visible: true },
          scrollState: { viewportOffset: 0, isAtBottom: true, scrollbackLength: 0 },
          cols: 80,
          rows: 24,
          isFull: false,
          alternateScreen: false,
          mouseTracking: false,
          cursorKeyMode: 'normal',
          inBandResize: false,
        },
        scrollState: { viewportOffset: 0, isAtBottom: true, scrollbackLength: 0 },
      });
      return () => {};
    },
    onExit: async () => () => {},
    getScrollState: async () => ({
      viewportOffset: 0,
      scrollbackLength: 0,
      isAtBottom: true,
    }),
    setScrollOffset: async () => undefined,
    setUpdateEnabled: async () => undefined,
    getEmulator: async () => {
      throw new Error('No emulator in test layer');
    },
    getEmulatorSync: () => null,
    setHostColors: async () => undefined,
    destroyAll: async () => {
      ptyIds.clear();
    },
    listAll: async () => Array.from(ptyIds),
    getForegroundProcess: async () => undefined,
    getGitBranch: async () => undefined,
    getGitInfo: async () => undefined,
    getGitDiffStats: async () => undefined,
    subscribeToLifecycle: () => () => {},
    getTitle: async () => '',
    getLastCommand: async () => undefined,
    subscribeToTitleChange: async () => () => {},
    subscribeToAllTitleChanges: () => () => {},
    dispose: () => {
      ptyIds.clear();
    },
  };
}
