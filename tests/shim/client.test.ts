import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';

// Set up test-specific socket path BEFORE any shim modules are imported
const testSocketDir = join(tmpdir(), `openmux-test-${Date.now()}`);
process.env.OPENMUX_SHIM_SOCKET_DIR = testSocketDir;
process.env.OPENMUX_SHIM_SOCKET_PATH = join(testSocketDir, 'test.sock');

// Module-level mock state that can be cleared by resetAllPtyState
const mockState = {
  ptyStates: new Map<string, { title: string }>(),
  metadataCache: new Map<string, any>(),
  kittyTransmits: [] as string[],
};

vi.mock('../../src/shim/client/state', () => ({
  getPtyState: vi.fn((ptyId: string) => mockState.ptyStates.get(ptyId)),
  handlePtyTitle: vi.fn((ptyId: string, title: string) => {
    const existing = mockState.ptyStates.get(ptyId);
    if (existing) {
      existing.title = title;
      return;
    }
    mockState.ptyStates.set(ptyId, { title });
  }),
  handlePtyActivity: vi.fn(),
  handlePtyKittyTransmit: vi.fn((ptyId: string, sequence: string) => {
    mockState.kittyTransmits.push(sequence);
  }),
  registerEmulatorFactory: vi.fn(),
  getKittyState: vi.fn(),
  setPtyState: vi.fn((ptyId: string, state: any) => {
    mockState.ptyStates.set(ptyId, state);
  }),
  deletePtyState: vi.fn((ptyId: string) => {
    mockState.ptyStates.delete(ptyId);
  }),
  subscribeState: vi.fn(() => () => {}),
  getCachedPtyMetadata: vi.fn((ptyId: string) => mockState.metadataCache.get(ptyId)),
  getPtyMetadataRequest: vi.fn(),
  setCachedPtyMetadata: vi.fn((ptyId: string, metadata: any) => {
    mockState.metadataCache.set(ptyId, {
      value: metadata,
      fetchedAt: Date.now(),
      stale: false,
    });
  }),
  setPtyMetadataRequest: vi.fn(),
  subscribeKittyTransmit: vi.fn((callback: any) => {
    // Replay buffered events
    for (const seq of mockState.kittyTransmits) {
      callback({ ptyId: 'pty-buffer', sequence: seq });
    }
    mockState.kittyTransmits.length = 0;
    return () => {};
  }),
  subscribeKittyUpdate: vi.fn(() => () => {}),
  subscribeScroll: vi.fn(() => () => {}),
  subscribeToActivity: vi.fn(() => () => {}),
  subscribeExit: vi.fn(() => () => {}),
  subscribeToAllTitles: vi.fn(() => () => {}),
  subscribeToLifecycle: vi.fn(() => () => {}),
  subscribeToTitle: vi.fn((ptyId: string, callback: any) => {
    const cached = mockState.ptyStates.get(ptyId)?.title;
    if (cached) {
      callback(cached);
    }
    return () => {};
  }),
  subscribeUnified: vi.fn((ptyId: string, callback: any) => {
    const cached = mockState.ptyStates.get(ptyId);
    if (cached?.terminalState) {
      callback({
        terminalUpdate: {
          dirtyRows: new Map(),
          cursor: cached.terminalState.cursor,
          scrollState: cached.scrollState,
          cols: cached.terminalState.cols,
          rows: cached.terminalState.rows,
          isFull: true,
          fullState: cached.terminalState,
          alternateScreen: cached.terminalState.alternateScreen,
          mouseTracking: cached.terminalState.mouseTracking,
          cursorKeyMode: cached.terminalState.cursorKeyMode ?? 'normal',
          kittyKeyboardFlags: cached.terminalState.kittyKeyboardFlags ?? 0,
          inBandResize: false,
        },
        scrollState: cached.scrollState,
      });
    }
    return () => {};
  }),
  getEmulator: vi.fn(),
  resetAllPtyState: vi.fn(() => {
    mockState.ptyStates.clear();
    mockState.metadataCache.clear();
    mockState.kittyTransmits.length = 0;
  }),
}));

// Connection mock removed - tests now use environment variable to avoid
// connecting to the user's real openmux socket. See OPENMUX_SHIM_SOCKET_PATH
// setup above which is applied before any shim modules are imported.

let getPtyState: typeof import('../../src/shim/client/state').getPtyState;
let handlePtyTitle: typeof import('../../src/shim/client/state').handlePtyTitle;
let sendRequest: typeof import('../../src/shim/client/connection').sendRequest;
let connectionModule: typeof import('../../src/shim/client/connection');
let shimClientNonce = 0;

describe('shim client getTitle', () => {
  beforeAll(async () => {
    ({ getPtyState, handlePtyTitle } = await import('../../src/shim/client/state'));
    connectionModule = await import('../../src/shim/client/connection');
    sendRequest = connectionModule.sendRequest;
  });

  beforeEach(() => {
    mockState.ptyStates.clear();
    vi.clearAllMocks();
  });

  test('returns cached non-empty titles without requesting', async () => {
    mockState.ptyStates.set('pty-1', { title: 'Opencode' });

    // Spy on sendRequest to verify it's not called
    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest');

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-1');

    expect(title).toBe('Opencode');
    expect(sendRequestSpy).not.toHaveBeenCalled();
    expect(getPtyState).toHaveBeenCalled();
  });

  test('refreshes empty cached titles from the shim', async () => {
    mockState.ptyStates.set('pty-2', { title: '' });

    // Mock the shim server response by spying and mocking the implementation
    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest').mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-2');

    expect(title).toBe('shell');
    expect(sendRequestSpy).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-2' });
    expect(handlePtyTitle).toHaveBeenCalledWith('pty-2', 'shell');
    expect(mockState.ptyStates.get('pty-2')?.title).toBe('shell');

    sendRequestSpy.mockRestore();
  });

  test('requests title when no cache exists', async () => {
    // Mock the shim server response
    const sendRequestSpy = vi.spyOn(connectionModule, 'sendRequest').mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-3');

    expect(title).toBe('shell');
    expect(sendRequestSpy).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-3' });
    expect(handlePtyTitle).toHaveBeenCalledWith('pty-3', 'shell');
    expect(mockState.ptyStates.get('pty-3')?.title).toBe('shell');

    sendRequestSpy.mockRestore();
  });
});
