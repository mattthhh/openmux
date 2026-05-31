/**
 * File opener and diff opener action handlers.
 *
 * Encapsulates file/diff opener toggling, selection handling,
 * and pane creation for file/diff editing.
 */

import * as errore from 'errore';
import { execFile } from 'node:child_process';
import { openInFileManager, buildEditorCommand } from '../../../core/file-opener';
import { buildDiffCommand, type DiffTarget } from '../../../core/diff-opener';
import type { useConfig } from '../../../contexts/ConfigContext';
import type { TerminalContextValue } from '../../../contexts/TerminalContext';
import type { OverlayContextValue } from '../../../contexts/OverlayContext';
import type { AggregateViewState } from '../../../contexts/aggregate-view-types';
import type { AggregateCommandActions } from './types';
import type { FileEntry } from '../../../core/file-opener';

export interface OpenerActionsDeps {
  config: ReturnType<typeof useConfig>;
  terminal: TerminalContextValue;
  overlays: OverlayContextValue;
  aggregateState: AggregateViewState;
  aggregateActions: AggregateCommandActions;
}

export interface OpenerActions {
  handleToggleFileOpener: () => Promise<void>;
  handleFileOpenerSelect: (entry: FileEntry) => Promise<void>;
  handleToggleDiffOpener: () => Promise<void>;
  handleDiffOpenerSelect: (target: DiffTarget) => Promise<void>;
}

export function createOpenerActions(deps: OpenerActionsDeps): OpenerActions {
  const { config, terminal, overlays, aggregateState, aggregateActions } = deps;

  const handleToggleFileOpener = async () => {
    if (overlays.fileOpenerState.show) {
      overlays.closeFileOpener();
      return;
    }

    // In aggregate view, resolve CWD from the selected PTY
    if (aggregateState.showAggregateView) {
      const ptyId = aggregateActions.getSelectedPtyId();
      if (ptyId) {
        const cwd = await terminal.getSessionCwd(ptyId).catch(() => null);
        if (cwd) {
          overlays.openFileOpener(cwd);
          return;
        }
      }
    }

    // Fallback: resolve CWD from the focused pane's PTY
    const cwd = await terminal.getFocusedCwd().catch(() => null);
    const rootDir = cwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
    overlays.openFileOpener(rootDir);
  };

  const handleFileOpenerSelect = async (entry: FileEntry) => {
    if (entry.isFolderAction) {
      void openInFileManager(entry.absolutePath);
      return;
    }

    // In aggregate view, delegate to the state manager which handles
    // pending insertions, autoswitch, and editor command injection
    // while staying in the aggregate view.
    if (aggregateState.showAggregateView) {
      void aggregateActions.handleOpenFileInSession({
        ...entry,
        rootDir: overlays.fileOpenerState.rootDir || process.cwd(),
      });
      return;
    }

    // Workspace mode: create pane directly in the active workspace
    const fileOpenerSettings = config.config().fileOpener;
    const commandParts = buildEditorCommand(fileOpenerSettings, entry.absolutePath);
    const fullCommand = `${fileOpenerSettings.editor} ${commandParts.join(' ')}`;
    // Use the rootDir (where the file opener was invoked) as CWD,
    // not the directory containing the file
    const cwd = overlays.fileOpenerState.rootDir || process.cwd();

    const result = await terminal.createPaneWithPTY(cwd);
    if (!result) return;

    terminal.writeToPTY(result.ptyId, `${fullCommand}\n`);
  };

  const handleToggleDiffOpener = async () => {
    if (overlays.diffOpenerState.show) {
      overlays.closeDiffOpener();
      return;
    }

    // In aggregate view, resolve CWD from the selected PTY
    if (aggregateState.showAggregateView) {
      const ptyId = aggregateActions.getSelectedPtyId();
      if (ptyId) {
        const cwd = await terminal.getSessionCwd(ptyId).catch(() => null);
        if (cwd) {
          overlays.openDiffOpener(cwd);
          return;
        }
      }
    }

    const cwd = await terminal.getFocusedCwd().catch(() => null);
    const rootDir = cwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
    overlays.openDiffOpener(rootDir);
  };

  const handleDiffOpenerSelect = async (target: DiffTarget) => {
    if (target.isSeparator) return;

    const settings = config.config().diffOpener;
    const cwd = overlays.diffOpenerState.rootDir || process.cwd();

    // Check if fzf is available and preferred
    let useFzf = settings.preferFzf;
    if (useFzf) {
      const fzfCheck = await errore.tryAsync<string, Error>({
        try: () =>
          new Promise<string>((resolve, reject) => {
            execFile('which', ['fzf'], (err, stdout) => {
              if (err) reject(err);
              else resolve(stdout);
            });
          }),
        catch: () => new Error('fzf not found'),
      });
      useFzf = !(fzfCheck instanceof Error);
    }

    const commandTemplate = useFzf ? settings.fzfCommand : settings.command;
    const fullCommand = buildDiffCommand(commandTemplate, target);

    // In aggregate view, delegate to the state manager which handles
    // pending insertions, autoswitch, and diff command injection
    // while staying in the aggregate view.
    if (aggregateState.showAggregateView) {
      void aggregateActions.handleOpenDiffInSession(target, cwd, fullCommand);
      return;
    }

    const result = await terminal.createPaneWithPTY(cwd);
    if (!result) return;

    terminal.writeToPTY(result.ptyId, `${fullCommand}\n`);
  };

  return {
    handleToggleFileOpener,
    handleFileOpenerSelect,
    handleToggleDiffOpener,
    handleDiffOpenerSelect,
  };
}
