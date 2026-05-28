import { describe, expect, it } from 'bun:test';

import { resolvePaneRename } from '../../src/components/pane-rename-utils';

describe('resolvePaneRename', () => {
  it('clears manual title when input is empty', () => {
    expect(resolvePaneRename('   ', 'shell')).toEqual({ type: 'clear', title: 'shell' });
  });

  it('returns trimmed manual title', () => {
    expect(resolvePaneRename('  Opencode  ', 'shell')).toEqual({
      type: 'manual',
      title: 'Opencode',
    });
  });
});
