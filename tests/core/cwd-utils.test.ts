import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repairLikelyTrailingPercentCwd } from '../../src/core/cwd-utils';

describe('repairLikelyTrailingPercentCwd', () => {
  it('repairs a trailing percent when the trimmed path exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-cwd-utils-'));
    const validPath = path.join(root, 'project');
    fs.mkdirSync(validPath);

    expect(repairLikelyTrailingPercentCwd(`${validPath}%`)).toBe(validPath);
  });

  it('keeps legitimate directories ending with percent intact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmux-cwd-utils-'));
    const validPath = path.join(root, 'project%');
    fs.mkdirSync(validPath);

    expect(repairLikelyTrailingPercentCwd(validPath)).toBe(validPath);
  });

  it('leaves ordinary paths unchanged', () => {
    expect(repairLikelyTrailingPercentCwd('/tmp/project')).toBe('/tmp/project');
  });
});
