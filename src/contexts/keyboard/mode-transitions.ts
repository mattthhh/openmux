import { produce, type SetStoreFunction } from 'solid-js/store';

import type { ConfirmationType, KeyMode, KeyboardState } from '../../core/types';

type KeyboardMode = Exclude<KeyMode, 'normal'>;
type SharedMode = Exclude<KeyboardMode, 'prefix' | 'confirm'>;

function setNormalMode(
  setState: SetStoreFunction<KeyboardState>,
  update?: (state: KeyboardState) => void
): void {
  setState(
    produce((state) => {
      state.mode = 'normal';
      state.prefixActivatedAt = undefined;
      update?.(state);
    })
  );
}

function enterMode(setState: SetStoreFunction<KeyboardState>, mode: KeyboardMode): void {
  setState(
    produce((state) => {
      state.mode = mode;
      state.prefixActivatedAt = undefined;
    })
  );
}

export function createPrefixModeHandlers(setState: SetStoreFunction<KeyboardState>) {
  return {
    enter: () => {
      setState(
        produce((state) => {
          state.mode = 'prefix';
          state.prefixActivatedAt = Date.now();
        })
      );
    },
    exit: () => setNormalMode(setState),
  };
}

export function createModeTransitionHandlers(
  setState: SetStoreFunction<KeyboardState>,
  mode: SharedMode
) {
  return {
    enter: () => enterMode(setState, mode),
    exit: () => setNormalMode(setState),
  };
}

export function createConfirmModeHandlers(setState: SetStoreFunction<KeyboardState>) {
  return {
    enter: (confirmationType: ConfirmationType) => {
      setState(
        produce((state) => {
          state.mode = 'confirm';
          state.prefixActivatedAt = undefined;
          state.confirmationType = confirmationType;
        })
      );
    },
    exit: () =>
      setNormalMode(setState, (state) => {
        state.confirmationType = undefined;
      }),
  };
}
