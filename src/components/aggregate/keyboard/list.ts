import type { KeyboardEvent } from '../../../effect/bridge';
import { eventToCombo, matchKeybinding } from '../../../core/keybindings';
import type { ListDeps } from './types';
import { isBareEscape } from './helpers';

export function createAggregateListHandler(deps: ListDeps) {
  const handleListAction = (action: string | null): boolean => {
    switch (action) {
      case 'aggregate.list.down':
        deps.navigateDown();
        return true;
      case 'aggregate.list.up':
        deps.navigateUp();
        return true;
      case 'aggregate.list.pageUp':
        deps.scrollListUp?.(5);
        return true;
      case 'aggregate.list.pageDown':
        deps.scrollListDown?.(5);
        return true;
      case 'aggregate.list.top':
        deps.setSelectedIndex(0);
        deps.setListScrollOffset?.(0);
        return true;
      case 'aggregate.list.bottom': {
        const count = deps.getMatchedCount();
        if (count > 0) {
          deps.setSelectedIndex(count - 1);
        }
        return true;
      }
      case 'aggregate.list.preview':
        return deps.handleListEnter();
      case 'aggregate.list.jump':
        deps.handleJumpToPty();
        return true;
      case 'aggregate.list.new.pane':
        deps.handleNewPaneInSession();
        return true;
      case 'aggregate.list.toggle.scope':
        deps.toggleShowInactive();
        return true;
      case 'aggregate.list.delete':
        deps.setFilterQuery(deps.getFilterQuery().slice(0, -1));
        return true;
      case 'aggregate.list.close':
        deps.closeAggregateView();
        deps.exitAggregateMode();
        return true;
      case 'aggregate.kill': {
        const selectedPtyId = deps.getSelectedPtyId();
        if (selectedPtyId && deps.onRequestKillPty) {
          deps.onRequestKillPty(selectedPtyId);
        }
        return true;
      }
      default:
        return false;
    }
  };

  const handleListInput = (event: KeyboardEvent): boolean => {
    const { key } = event;
    if (key.length === 1 && !event.ctrl && !event.alt && !event.meta) {
      deps.setFilterQuery(deps.getFilterQuery() + key);
      return true;
    }
    return true;
  };

  const handleListModeKeys = (event: KeyboardEvent): boolean => {
    const keybindings = deps.getKeybindings();
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };
    const action = matchKeybinding(keybindings.aggregate.list, keyEvent);

    if (!deps.getVimEnabled()) {
      if (handleListAction(action)) return true;
      return handleListInput(event);
    }

    if (deps.getVimMode() === 'insert') {
      if (isBareEscape(event)) {
        deps.setVimMode('normal');
        deps.getVimHandlers().list.reset();
        return true;
      }
      if (handleListAction(action)) return true;
      return handleListInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      deps.setVimMode('insert');
      deps.getVimHandlers().list.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = deps.getVimHandlers().list.handleCombo(combo);
    if (result.pending) return true;
    if (handleListAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings =
      !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const fallbackAction = matchKeybinding(keybindings.aggregate.list, keyEvent);
      if (handleListAction(fallbackAction)) return true;
    }

    return true;
  };

  return { handleListModeKeys };
}
