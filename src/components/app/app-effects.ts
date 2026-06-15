/**
 * App effects and wiring for overlays, clipboard, and host focus.
 */

import { createEffect, onCleanup } from 'solid-js';
import type { PasteEvent, CliRenderer } from '@opentui/core';
import { getCommandsForContext } from '../../core/command-palette';
import { checkForUpdateLabel } from '../../core/update-checker';
import { setupClipboardAndShimBridge } from './clipboard-bridge';
import { setupFocusedPtyRegistry, setupHostFocusTracking } from './focus-tracking';
import { setupOverlayClipRects } from './overlay-clips';

type OverlayClipDeps = Parameters<typeof setupOverlayClipRects>[0];

export type AppEffectsDeps = Omit<OverlayClipDeps, 'commandPaletteCommands'> & {
  renderer: CliRenderer;
  pasteHandler: { handleBracketedPaste: (event: PasteEvent) => void };
  setUpdateLabel: (label: string | null) => void;
  setClipboardPasteHandler: (handler: (ptyId: string) => Promise<boolean> | boolean) => void;
  setCopyModeExitCallback: (callback: (() => void) | null) => void;
  readFromClipboard: () => Promise<string | null>;
  writeToPTY: (ptyId: string, data: string) => void | Promise<void>;
  onShimDetached: (handler: () => void) => () => void;
  handleShimDetached: () => void;
  getFocusedPtyId: () => string | null | undefined;
  isPtyActive: (ptyId: string) => boolean;
};

export function setupAppEffects(deps: AppEffectsDeps): void {
  const {
    renderer,
    pasteHandler,
    setUpdateLabel,
    setClipboardPasteHandler,
    setCopyModeExitCallback,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached,
    getFocusedPtyId,
    isPtyActive,
    ...overlayDeps
  } = deps;

  setupOverlayClipRects({
    ...(overlayDeps as Omit<OverlayClipDeps, 'commandPaletteCommands'>),
    commandPaletteCommands: () =>
      getCommandsForContext(overlayDeps.aggregateState.showAggregateView),
  });

  setupClipboardAndShimBridge({
    setClipboardPasteHandler,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached,
  });

  setupFocusedPtyRegistry(getFocusedPtyId);

  // Wire up the copy mode exit callback so bracketed paste can
  // exit copy mode before writing pasted content to the PTY
  setCopyModeExitCallback(null);

  setupHostFocusTracking({
    renderer,
    isPtyActive,
    getFocusedPtyId,
  });

  createEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const label = await checkForUpdateLabel(controller.signal);
      if (label) setUpdateLabel(label);
    })();

    onCleanup(() => {
      controller.abort();
    });
  });

  createEffect(() => {
    renderer.keyInput.on('paste', pasteHandler.handleBracketedPaste);

    onCleanup(() => {
      renderer.keyInput.off('paste', pasteHandler.handleBracketedPaste);
    });
  });
}
