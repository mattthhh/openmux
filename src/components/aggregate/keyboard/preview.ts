import { writeToPty } from '../../../effect/bridge';
import type { KeyboardEvent } from '../../../effect/bridge';
import { encodeKeyForEmulator } from '../../../terminal/key-encoder';
import { matchKeybinding } from '../../../core/keybindings';
import { isSavedAggregatePtyId } from '../../../contexts/aggregate/rows';
import type { PreviewDeps } from './types';

export function createAggregatePreviewHandler(deps: PreviewDeps) {
  const forwardToPreviewPty = (event: KeyboardEvent): boolean => {
    const selectedPtyId = deps.getPreviewPtyId();
    if (selectedPtyId && !isSavedAggregatePtyId(selectedPtyId)) {
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

    if (action === 'aggregate.kill') {
      const selectedPtyId = deps.getPreviewPtyId();
      if (selectedPtyId && deps.onRequestKillPty) {
        deps.onRequestKillPty(selectedPtyId);
      }
      return true;
    }

    // New pane creation (alt+n convenience binding)
    if (action === 'aggregate.preview.new.pane') {
      void deps.handleNewPaneInSession();
      return true;
    }

    // Navigate between panes without exiting preview mode (alt+j/k convenience bindings)
    if (action === 'aggregate.preview.down') {
      deps.navigateToNextPty();
      return true;
    }

    if (action === 'aggregate.preview.up') {
      deps.navigateToPrevPty();
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
