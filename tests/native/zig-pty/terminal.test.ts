import { describe, expect, it } from 'bun:test';

import { Terminal } from '../../../native/zig-pty/ts/terminal';

describe('zig-pty Terminal.fromHandle initialization', () => {
  it('initializes foreground process change emitter state in _initializePumpState', () => {
    const term = Object.create(Terminal.prototype) as Terminal & {
      _initializePumpState: () => void;
      _onForegroundProcessChange?: { event?: unknown };
    };

    term._initializePumpState();

    expect(term._onForegroundProcessChange).toBeDefined();
    expect(() => term.onForegroundProcessChange).not.toThrow();
  });
});
