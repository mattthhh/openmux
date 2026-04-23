/**
 * Test PTY Service Implementation
 * Mock PTY for testing purposes.
 */
import type { TerminalState, UnifiedTerminalUpdate } from '../../../core/types';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { TerminalColors } from '../../../terminal/terminal-colors';
import { PtyNotFoundError } from '../../errors';
import type { PtyId, Cols, Rows } from '../../types';
import type { PtySession } from '../../models';
import { makePtyId } from '../../types';
import type { GitInfo } from './helpers';
import type {
  PtyService,
  PtyCwdChangeEvent,
  PtyTitleChangeEvent,
  GetPtyGitInfoOptions,
} from './interface';

/**
 * Create test PTY service - mock PTY for testing.
 */
export function createTestPtyService(): PtyService {
  const ptyIds = new Set<PtyId>();
  const destroyedPtyIds = new Set<PtyId>();

  function getEmulator(id: PtyId, options: { sync: true }): ITerminalEmulator | null;
  function getEmulator(
    id: PtyId,
    options?: { sync?: false }
  ): Promise<PtyNotFoundError | ITerminalEmulator>;
  function getEmulator(
    _id: PtyId,
    options: { sync?: boolean } = {}
  ): ITerminalEmulator | null | Promise<PtyNotFoundError | ITerminalEmulator> {
    if (options.sync) {
      return null;
    }

    return Promise.resolve(new PtyNotFoundError({ ptyId: 'test' }));
  }

  function subscribeToTitle(
    id: PtyId,
    callback: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)>;
  function subscribeToTitle(callback: (event: PtyTitleChangeEvent) => void): () => void;
  function subscribeToTitle(
    idOrCallback: PtyId | ((event: PtyTitleChangeEvent) => void),
    _maybeCallback?: (title: string) => void
  ): Promise<PtyNotFoundError | (() => void)> | (() => void) {
    if (typeof idOrCallback === 'function') {
      return () => {};
    }
    return Promise.resolve(() => {});
  }

  return {
    create: async () => {
      const id = makePtyId();
      ptyIds.add(id);
      destroyedPtyIds.delete(id);
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
      if (destroyedPtyIds.has(id)) {
        return new PtyNotFoundError({ ptyId: id });
      }

      const idStr = String(id);
      const isValidFormat = idStr.startsWith('pty-') || ptyIds.has(id);
      if (!isValidFormat) {
        return new PtyNotFoundError({ ptyId: id });
      }

      return {
        id,
        pid: 12345,
        cols: 80 as Cols,
        rows: 24 as Rows,
        cwd: '/test/cwd',
        shell: '/bin/bash',
        title: '',
        lastCommand: undefined,
      } satisfies PtySession;
    },
    getTerminalState: async () =>
      ({
        cells: [],
        cursorX: 0,
        cursorY: 0,
        cursorVisible: true,
      }) as unknown as TerminalState,
    subscribe: async (_id: PtyId, callback: (update: UnifiedTerminalUpdate) => void) => {
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
    getEmulator,
    setHostColors: async (_colors: TerminalColors) => undefined,
    destroyAll: async () => {
      ptyIds.clear();
    },
    listAll: async () => Array.from(ptyIds),
    getForegroundProcess: async () => undefined,
    getGitInfo: async (
      _id: PtyId,
      _options: GetPtyGitInfoOptions = {}
    ): Promise<GitInfo | undefined> => undefined,
    subscribeToLifecycle: () => () => {},
    subscribeToTitle,
    subscribeToAllActivity: () => () => {},
    subscribeToForegroundProcessChange: () => () => {},
    subscribeToCwdChange: (_callback: (event: PtyCwdChangeEvent) => void) => () => {},
    dispose: () => {
      ptyIds.clear();
    },
  };
}
