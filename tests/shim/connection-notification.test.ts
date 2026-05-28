import { describe, expect, it, vi } from 'bun:test';
import { handlePtyNotification } from '../../src/shim/client/connection';
import type { DesktopNotification } from '../../src/terminal/command-parser';

const baseNotification: DesktopNotification = {
  title: 'Title',
  body: 'Body',
  source: 'osc9',
};

describe('handlePtyNotification', () => {
  it('falls back to desktop notification when macOS send fails', () => {
    const sendMacOsNotification = vi.fn(() => false);
    const sendDesktopNotification = vi.fn(() => true);

    handlePtyNotification(
      {
        notification: baseNotification,
        subtitle: 'Sub',
        ptyId: 'pty-1',
        hostFocused: true,
        focusedPtyId: 'pty-2',
        allowFocusedPaneOsc: false,
      },
      { sendMacOsNotification, sendDesktopNotification }
    );

    expect(sendMacOsNotification).toHaveBeenCalledOnce();
    expect(sendDesktopNotification).toHaveBeenCalledOnce();
  });

  it('uses macOS notification when host is focused and pane is unfocused', () => {
    const sendMacOsNotification = vi.fn(() => true);
    const sendDesktopNotification = vi.fn(() => true);

    handlePtyNotification(
      {
        notification: baseNotification,
        subtitle: 'Sub',
        ptyId: 'pty-1',
        hostFocused: true,
        focusedPtyId: 'pty-2',
        allowFocusedPaneOsc: false,
      },
      { sendMacOsNotification, sendDesktopNotification }
    );

    expect(sendMacOsNotification).toHaveBeenCalledOnce();
    expect(sendDesktopNotification).not.toHaveBeenCalled();
  });

  it('uses desktop notification when host is unfocused', () => {
    const sendMacOsNotification = vi.fn(() => true);
    const sendDesktopNotification = vi.fn(() => true);

    handlePtyNotification(
      {
        notification: baseNotification,
        subtitle: 'Sub',
        ptyId: 'pty-1',
        hostFocused: false,
        focusedPtyId: 'pty-1',
        allowFocusedPaneOsc: false,
      },
      { sendMacOsNotification, sendDesktopNotification }
    );

    expect(sendMacOsNotification).not.toHaveBeenCalled();
    expect(sendDesktopNotification).toHaveBeenCalledOnce();
  });

  it('uses desktop notification for focused pane when allowed', () => {
    const sendMacOsNotification = vi.fn(() => true);
    const sendDesktopNotification = vi.fn(() => true);

    handlePtyNotification(
      {
        notification: baseNotification,
        subtitle: 'Sub',
        ptyId: 'pty-1',
        hostFocused: true,
        focusedPtyId: 'pty-1',
        allowFocusedPaneOsc: true,
      },
      { sendMacOsNotification, sendDesktopNotification }
    );

    expect(sendMacOsNotification).not.toHaveBeenCalled();
    expect(sendDesktopNotification).toHaveBeenCalledOnce();
  });
});
