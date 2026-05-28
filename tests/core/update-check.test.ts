import { describe, expect, it } from 'bun:test';
import { compareSemver, isUpdateAvailable } from '../../src/core/update-check';

describe('update-check', () => {
  it('compares versions with leading v', () => {
    expect(compareSemver('v0.2.0', '0.2.1')).toBeLessThan(0);
  });

  it('treats prerelease as lower than stable', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
  });

  it('returns equal for same versions', () => {
    expect(compareSemver('0.2.3', '0.2.3')).toBe(0);
  });

  it('flags update availability when latest is newer', () => {
    expect(isUpdateAvailable('0.2.0', '0.3.0')).toBe(true);
  });

  it('does not flag update when current is newer', () => {
    expect(isUpdateAvailable('0.3.0', '0.2.9')).toBe(false);
  });
});
