import { createEffect } from 'solid-js';
import { createVimSequenceHandler } from '../../core/vim-sequences';
import type { useConfig } from '../../contexts/ConfigContext';

const COPY_VIM_SEQUENCES = [
  { keys: ['g', 'g'], action: 'cursor.top' },
  { keys: ['i', 'w'], action: 'select.inner.word' },
  { keys: ['a', 'w'], action: 'select.around.word' },
];

export function createCopyModeVimState(params: {
  config: ReturnType<typeof useConfig>;
  isCopyModeActive: () => boolean;
}): {
  getCopyVimHandler: () => {
    handleCombo: (combo: string) => { action: string | null; pending: boolean };
    reset: () => void;
  };
} {
  const { config, isCopyModeActive } = params;

  let copyVimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: COPY_VIM_SEQUENCES,
  });

  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs;
    copyVimHandler.reset();
    copyVimHandler = createVimSequenceHandler({
      timeoutMs,
      sequences: COPY_VIM_SEQUENCES,
    });
  });

  createEffect((prevActive: boolean | undefined) => {
    const active = isCopyModeActive();
    if (active && !prevActive) {
      copyVimHandler.reset();
    }
    return active;
  });

  return {
    getCopyVimHandler: () => copyVimHandler,
  };
}
