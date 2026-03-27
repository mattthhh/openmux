import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import { setPtyUpdateEnabled } from '../../../effect/bridge';
import {
  attachVisibleEmulator,
  clearVisiblePty,
  ensureActivityPtyEnabled,
  registerActivityPty,
  registerVisiblePty,
  unregisterActivityPty,
  unregisterVisiblePty,
} from '../visibility';

describe('terminal-view visibility gating (litmus)', () => {
  beforeEach(() => {
    vi.mocked(setPtyUpdateEnabled).mockClear();
  });

  it('does not disable a visible PTY when aggregate activity tracking releases', () => {
    const ptyId = 'pty-visible-activity';
    const setUpdateEnabledMock = mock(() => {});
    const emulator = {
      isDisposed: false,
      setUpdateEnabled: setUpdateEnabledMock,
    } as unknown as ITerminalEmulator;

    registerVisiblePty(ptyId);
    attachVisibleEmulator(ptyId, emulator);
    registerActivityPty(ptyId);

    vi.mocked(setPtyUpdateEnabled).mockClear();
    setUpdateEnabledMock.mockClear();

    unregisterActivityPty(ptyId);

    expect(setPtyUpdateEnabled).not.toHaveBeenCalledWith(ptyId, false);
    expect(setUpdateEnabledMock).not.toHaveBeenCalledWith(false);

    unregisterVisiblePty(ptyId, emulator);
  });

  it('disables a PTY when the last activity hold is released', () => {
    const ptyId = 'pty-activity-only';

    registerActivityPty(ptyId);
    vi.mocked(setPtyUpdateEnabled).mockClear();

    unregisterActivityPty(ptyId);

    expect(setPtyUpdateEnabled).toHaveBeenCalledWith(ptyId, false);
  });

  it('keeps activity tracking alive when visible state is cleared', () => {
    const ptyId = 'pty-clear-visible';

    registerVisiblePty(ptyId);
    registerActivityPty(ptyId);

    vi.mocked(setPtyUpdateEnabled).mockClear();

    clearVisiblePty(ptyId);
    expect(setPtyUpdateEnabled).not.toHaveBeenCalledWith(ptyId, false);

    ensureActivityPtyEnabled(ptyId);
    expect(setPtyUpdateEnabled).toHaveBeenCalledWith(ptyId, true);

    vi.mocked(setPtyUpdateEnabled).mockClear();
    unregisterActivityPty(ptyId);
    expect(setPtyUpdateEnabled).toHaveBeenCalledWith(ptyId, false);
  });
});
