import { describe, expect, test, vi } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Workspace } from '../../src/core/types';
import type { LayoutState } from '../../src/core/operations/layout-actions';
import { DEFAULT_CONFIG } from '../../src/core/config';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';

const mockControlProtocol = async () => {
  const protocol = await import('../../src/control/protocol');
  vi.mock('../../src/control/protocol', () => ({
    ...protocol,
    CONTROL_SOCKET_DIR: process.env.OPENMUX_CONTROL_SOCKET_DIR,
    CONTROL_SOCKET_PATH: process.env.OPENMUX_CONTROL_SOCKET_PATH,
  }));
};

function createLayoutState(workspace: Workspace): LayoutState {
  return {
    workspaces: { [workspace.id]: workspace },
    activeWorkspaceId: workspace.id,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: DEFAULT_CONFIG,
    layoutVersion: 0,
    layoutGeometryVersion: 0,
  };
}

describe('control server smoke', () => {
  test('pane.send routes through control socket', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-control-'));
    process.env.OPENMUX_CONTROL_SOCKET_DIR = tempDir;
    process.env.OPENMUX_CONTROL_SOCKET_PATH = path.join(tempDir, 'openmux-ui.sock');

    await mockControlProtocol();

    const { startControlServer } = await import('../../src/control/server');
    const { connectControlClient } = await import('../../src/control/client');

    const workspace: Workspace = {
      id: 1,
      label: undefined,
      mainPane: { id: 'pane-1', ptyId: 'pty-1' },
      stackPanes: [],
      focusedPaneId: 'pane-1',
      activeStackIndex: 0,
      layoutMode: 'vertical',
      zoomed: false,
    };

    const layoutState = createLayoutState(workspace);
    let sent: { ptyId: string; data: string } | null = null;

    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: () => {},
      focusPane: () => {},
      splitPane: () => {},
      writeToPty: (ptyId, data) => {
        sent = { ptyId, data };
      },
      getEmulator: () => null as ITerminalEmulator | null,
      fetchTerminalState: async (_ptyId, _options) => null,
      fetchScrollState: async (_ptyId, _options) => null,
      capturePty: async () => null,
      isPtyActive: () => true,
      createSession: async () => ({
        id: 'session-1',
        name: 'test',
        createdAt: Date.now(),
        lastSwitchedAt: Date.now(),
        autoNamed: false,
      }),
      getActiveSessionId: () => 'session-1',
    });

    const client = await connectControlClient({
      socketPath: process.env.OPENMUX_CONTROL_SOCKET_PATH,
      timeoutMs: 500,
    });

    await client.request('pane.send', { text: 'echo test', pane: 'focused' });

    expect(sent).toEqual({ ptyId: 'pty-1', data: 'echo test' });

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
