import { describe, expect, it } from 'bun:test';
import { createRoot } from 'solid-js';

import { createTitleStore } from '../../src/contexts/TitleContext';

type TitleContextValue = ReturnType<typeof createTitleStore>;

const withTitleContext = (run: (context: TitleContextValue) => void) => {
  createRoot((dispose) => {
    const context = createTitleStore();
    run(context);
    dispose();
  });
};

describe('TitleContext', () => {
  it('clears auto title without removing manual overrides', () => {
    withTitleContext((context) => {
      context.setTitle('pane-1', 'auto');
      context.setManualTitle('pane-1', 'manual');
      context.clearAutoTitle('pane-1');
      expect(context.getTitle('pane-1')).toBe('manual');
    });
  });

  it('clears auto title when no manual override exists', () => {
    withTitleContext((context) => {
      context.setTitle('pane-2', 'auto');
      context.clearAutoTitle('pane-2');
      expect(context.getTitle('pane-2')).toBeUndefined();
    });
  });

  it('restores auto title after manual override is cleared', () => {
    withTitleContext((context) => {
      context.setTitle('pane-3', 'auto');
      context.setManualTitle('pane-3', 'manual');
      context.clearManualTitle('pane-3');
      expect(context.getTitle('pane-3')).toBe('auto');
    });
  });
});
