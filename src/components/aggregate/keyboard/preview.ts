import { writeToPty } from '../../../effect/bridge';
import type { KeyboardEvent } from '../../../effect/bridge';
import { encodeKeyForEmulator } from '../../../terminal/key-encoder';
import { matchKeybinding } from '../../../core/keybindings';
import type { AggregateKeyboardDeps } from './types';

export function createAggregatePreviewHandler(deps: AggregateKeyboardDeps) {
  const forwardToPreviewPty = (event: KeyboardEvent): boolean => {
    const selectedPtyId = deps.getSelectedPtyId();
    if (selectedPtyId) {
      const emulator = deps.getEmulatorSync(selectedPtyId);
      const inputStr = encodeKeyForEmulator(
        {
          key: event.key,
          ctrl: event.ctrl,
          alt: event.alt,
          shift: event.shift,
          sequence: event.sequence,
          baseCode: event.baseCode,
          eventType: event.eventType,
          repeated: event.repeated,
        },
        emulator
      );
      if (inputStr) {
        writeToPty(selectedPtyId, inputStr);
      }
    }
    return true;
  };

  const handlePreviewAction = (action: string | null): boolean => {
    if (!action) return false;

    if (action === 'aggregate.preview.search') {
      deps.handleEnterSearch();
      return true;
    }

    if (action === 'aggregate.preview.exit') {
      deps.exitPreviewMode();
      return true;
    }

    if (action === 'aggregate.preview.copy') {
      deps.handleEnterCopyMode();
      return true;
    }

    if (action === 'aggregate.kill') {
      const selectedPtyId = deps.getSelectedPtyId();
      if (selectedPtyId && deps.onRequestKillPty) {
        deps.onRequestKillPty(selectedPtyId);
      }
      return true;
    }

    return false;
  };

  const handlePreviewModeKeys = (event: KeyboardEvent): boolean => {
    if (event.eventType === 'release') {
      return forwardToPreviewPty(event);
    }

    const keybindings = deps.getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    const action = matchKeybinding(keybindings.aggregate.preview, keyEvent);
    if (handlePreviewAction(action)) return true;

    if (matchKeybinding(keybindings.normal, keyEvent) === 'copy.mode') {
      deps.handleEnterCopyMode();
      return true;
    }

    return forwardToPreviewPty(event);
  };

  return { handlePreviewModeKeys };
}
