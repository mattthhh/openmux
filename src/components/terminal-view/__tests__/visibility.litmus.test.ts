import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';

const setPtyUpdateEnabledMock = mock(async () => {});

mock.module('../../../effect/bridge', () => ({
  setPtyUpdateEnabled: setPtyUpdateEnabledMock,
}));

const {
  attachVisibleEmulator,
  clearVisiblePty,
  ensureActivityPtyEnabled,
  registerActivityPty,
  registerVisiblePty,
  unregisterActivityPty,
  unregisterVisiblePty,
} = await import('../visibility');

describe('terminal-view visibility gating (litmus)', () => {
  beforeEach(() => {
    setPtyUpdateEnabledMock.mockClear();
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

    setPtyUpdateEnabledMock.mockClear();
    setUpdateEnabledMock.mockClear();

    unregisterActivityPty(ptyId);

    expect(setPtyUpdateEnabledMock).not.toHaveBeenCalledWith(ptyId, false);
    expect(setUpdateEnabledMock).not.toHaveBeenCalledWith(false);

    unregisterVisiblePty(ptyId, emulator);
  });

  it('disables a PTY when the last activity hold is released', () => {
    const ptyId = 'pty-activity-only';

    registerActivityPty(ptyId);
    setPtyUpdateEnabledMock.mockClear();

    unregisterActivityPty(ptyId);

    expect(setPtyUpdateEnabledMock).toHaveBeenCalledWith(ptyId, false);
  });

  it('keeps activity tracking alive when visible state is cleared', () => {
    const ptyId = 'pty-clear-visible';

    registerVisiblePty(ptyId);
    registerActivityPty(ptyId);

    setPtyUpdateEnabledMock.mockClear();

    clearVisiblePty(ptyId);
    expect(setPtyUpdateEnabledMock).not.toHaveBeenCalledWith(ptyId, false);

    ensureActivityPtyEnabled(ptyId);
    expect(setPtyUpdateEnabledMock).toHaveBeenCalledWith(ptyId, true);

    setPtyUpdateEnabledMock.mockClear();
    unregisterActivityPty(ptyId);
    expect(setPtyUpdateEnabledMock).toHaveBeenCalledWith(ptyId, false);
  });
});
