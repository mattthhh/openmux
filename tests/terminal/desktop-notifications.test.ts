import { describe, expect, it } from 'bun:test';
import { buildOscSequence } from '../../src/terminal/desktop-notifications';
import type { DesktopNotification } from '../../src/terminal/command-parser';

describe('buildOscSequence', () => {
  it('builds OSC 9 sequence for osc9 notifications', () => {
    const notification: DesktopNotification = {
      title: 'Title',
      body: 'Body',
      source: 'osc9',
    };

    expect(buildOscSequence(notification)).toBe('\x1b]9;Title;Body\x07');
  });

  it('builds OSC 777 notify sequence for osc777 notifications', () => {
    const notification: DesktopNotification = {
      title: 'Title',
      body: 'Body',
      source: 'osc777',
    };

    expect(buildOscSequence(notification)).toBe('\x1b]777;notify;Title;Body\x07');
  });
});
