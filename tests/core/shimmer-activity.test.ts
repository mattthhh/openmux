import { beforeEach, describe, expect, it } from 'bun:test';
import {
  clearPtyStdoutActivity,
  hasRecentPtyStdoutActivity,
  recordPtyStdoutActivity,
} from '../../src/core/shimmer';

describe('shimmer stdout activity heuristic', () => {
  const ptyId = 'pty-shimmer-test';

  beforeEach(() => {
    clearPtyStdoutActivity(ptyId);
  });

  it('requires sustained recent stdout activity before shimmering', () => {
    const now = Date.now();
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(false);

    recordPtyStdoutActivity(ptyId, now - 500);
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(false);

    recordPtyStdoutActivity(ptyId, now);
    expect(hasRecentPtyStdoutActivity(ptyId, now)).toBe(true);
  });

  it('expires shimmer activity after the stdout window elapses', () => {
    recordPtyStdoutActivity(ptyId, 1000);
    recordPtyStdoutActivity(ptyId, 1500);

    expect(hasRecentPtyStdoutActivity(ptyId, 3000)).toBe(true);
    expect(hasRecentPtyStdoutActivity(ptyId, 5001)).toBe(false);
  });
});
