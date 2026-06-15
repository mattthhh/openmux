import { onCleanup, onMount } from 'solid-js';

export function setupClipboardAndShimBridge(params: {
  setClipboardPasteHandler: (handler: (ptyId: string) => Promise<boolean> | boolean) => void;
  readFromClipboard: () => Promise<string | null>;
  writeToPTY: (ptyId: string, data: string) => void | Promise<void>;
  onShimDetached: (handler: () => void) => () => void;
  handleShimDetached: () => void;
}) {
  const {
    setClipboardPasteHandler,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached,
  } = params;

  onMount(() => {
    // Bracketed paste mode sequences
    const PASTE_START = '\x1b[200~';
    const PASTE_END = '\x1b[201~';

    // Register clipboard paste handler
    // Returns true if clipboard read succeeded, false to fall back to stdin data
    // (important for SSH sessions where the server clipboard is empty)
    setClipboardPasteHandler(async (ptyId) => {
      try {
        // Read directly from system clipboard
        const clipboardText = await readFromClipboard();
        if (!clipboardText) return false;

        // Send complete paste atomically with brackets
        // Apps with bracketed paste mode expect the entire paste between markers
        const fullPaste = PASTE_START + clipboardText + PASTE_END;
        await Promise.resolve(writeToPTY(ptyId, fullPaste));
        return true;
      } catch (err) {
        console.error('Clipboard paste error:', err);
        return false;
      }
    });

    const unsubscribeDetached = onShimDetached(handleShimDetached);

    onCleanup(() => {
      unsubscribeDetached();
    });
  });
}
