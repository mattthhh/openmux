/**
 * Keyboard handler helpers for template overlay.
 */

import type { Accessor } from 'solid-js';
import { matchKeybinding, type ResolvedKeybindingMap } from '../../core/keybindings';
import type { KeyboardEvent } from '../../effect/bridge';

export type TemplateTabMode = 'apply' | 'save';

type TemplateOverlayKeyHandlerParams = {
  tab: Accessor<TemplateTabMode>;
  setTab: (mode: TemplateTabMode) => void;
  getTemplateCount: () => number;
  setSelectedIndex: (value: (current: number) => number) => void;
  onApply: () => void;
  onDelete: () => void;
  onClose: () => void;
  onSave: () => void;
  setSaveName: (value: (current: string) => string) => void;
  applyBindings: ResolvedKeybindingMap;
  saveBindings: ResolvedKeybindingMap;
};
