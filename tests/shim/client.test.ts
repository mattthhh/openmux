import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';

const ptyStates = new Map<string, { title: string }>();

vi.mock('../../src/shim/client/state', () => ({
  getPtyState: vi.fn((ptyId: string) => ptyStates.get(ptyId)),
  handlePtyTitle: vi.fn((ptyId: string, title: string) => {
    const existing = ptyStates.get(ptyId);
    if (existing) {
      existing.title = title;
      return;
    }
    ptyStates.set(ptyId, { title });
  }),
  registerEmulatorFactory: vi.fn(),
  getKittyState: vi.fn(),
  setPtyState: vi.fn(),
}));

vi.mock('../../src/shim/client/connection', () => ({
  sendRequest: vi.fn(),
  sendRequestDirect: vi.fn(),
  ensureConnected: vi.fn(),
  waitForShim: vi.fn(),
  onShimDetached: vi.fn(() => () => {}),
  shutdownShim: vi.fn(),
  handlePtyNotification: vi.fn(),
}));

let getPtyState: typeof import('../../src/shim/client/state').getPtyState;
let handlePtyTitle: typeof import('../../src/shim/client/state').handlePtyTitle;
let sendRequest: typeof import('../../src/shim/client/connection').sendRequest;
let shimClientNonce = 0;

describe('shim client getTitle', () => {
  beforeAll(async () => {
    ({ getPtyState, handlePtyTitle } = await import('../../src/shim/client/state'));
    ({ sendRequest } = await import('../../src/shim/client/connection'));
  });

  beforeEach(() => {
    ptyStates.clear();
    vi.clearAllMocks();
  });

  test('returns cached non-empty titles without requesting', async () => {
    ptyStates.set('pty-1', { title: 'Opencode' });

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-1');

    expect(title).toBe('Opencode');
    expect(sendRequest).not.toHaveBeenCalled();
    expect(handlePtyTitle).not.toHaveBeenCalled();
    expect(getPtyState).toHaveBeenCalled();
  });

  test('refreshes empty cached titles from the shim', async () => {
    ptyStates.set('pty-2', { title: '' });
    (sendRequest as any).mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-2');

    expect(title).toBe('shell');
    expect(sendRequest).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-2' });
    expect(handlePtyTitle).toHaveBeenCalledWith('pty-2', 'shell');
    expect(ptyStates.get('pty-2')?.title).toBe('shell');
  });

  test('requests title when no cache exists', async () => {
    (sendRequest as any).mockResolvedValue({
      header: { result: { title: 'shell' } },
      payloads: [],
    } as any);

    const { getTitle } = await import(`../../src/shim/client.ts?title=${shimClientNonce++}`);
    const title = await getTitle('pty-3');

    expect(title).toBe('shell');
    expect(sendRequest).toHaveBeenCalledWith('getTitle', { ptyId: 'pty-3' });
    expect(handlePtyTitle).toHaveBeenCalledWith('pty-3', 'shell');
    expect(ptyStates.get('pty-3')?.title).toBe('shell');
  });
});
