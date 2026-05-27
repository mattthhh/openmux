/**
 * Shared keybinding types.
 */

export interface KeybindingEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type KeybindingMap = Record<string, string | null | undefined | false>;

export interface KeybindingsConfig {
  prefixKey: string;
  prefixTimeoutMs: number;
  normal: KeybindingMap;
  prefix: KeybindingMap;
  move: KeybindingMap;
  search: KeybindingMap;
  commandPalette: KeybindingMap;
  fileOpener: KeybindingMap;
  templateOverlay: {
    apply: KeybindingMap;
    save: KeybindingMap;
  };
  aggregate: {
    list: KeybindingMap;
    preview: KeybindingMap;
    search: KeybindingMap;
    prefix: KeybindingMap;
  };
  sessionPicker: {
    list: KeybindingMap;
    rename: KeybindingMap;
  };
  ptyPicker: {
    list: KeybindingMap;
  };
  confirmation: KeybindingMap;
}

export interface ResolvedKeybindingMap {
  byCombo: Map<string, string>;
  byAction: Map<string, string[]>;
}

export interface ResolvedKeybindings {
  prefixKey: string;
  prefixTimeoutMs: number;
  normal: ResolvedKeybindingMap;
  prefix: ResolvedKeybindingMap;
  move: ResolvedKeybindingMap;
  search: ResolvedKeybindingMap;
  commandPalette: ResolvedKeybindingMap;
  fileOpener: ResolvedKeybindingMap;
  templateOverlay: {
    apply: ResolvedKeybindingMap;
    save: ResolvedKeybindingMap;
  };
  aggregate: {
    list: ResolvedKeybindingMap;
    preview: ResolvedKeybindingMap;
    search: ResolvedKeybindingMap;
    prefix: ResolvedKeybindingMap;
  };
  sessionPicker: {
    list: ResolvedKeybindingMap;
    rename: ResolvedKeybindingMap;
  };
  ptyPicker: {
    list: ResolvedKeybindingMap;
  };
  confirmation: ResolvedKeybindingMap;
}
