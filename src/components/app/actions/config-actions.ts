/**
 * Console and configuration action handlers.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as errore from 'errore';
import { FileSystemError } from '../../../effect/errors';
import { setKeyboardVimMode, setKeyboardPrefixOnly } from '../../../core/user-config';
import type { useConfig } from '../../../contexts/ConfigContext';
import type { TerminalContextValue } from '../../../contexts/TerminalContext';

export interface ConfigActionsDeps {
  config: ReturnType<typeof useConfig>;
  terminal: TerminalContextValue;
  renderer: { console: { toggle: () => void; getCachedLogs: () => string } };
}

export interface ConfigActions {
  handleToggleConsole: () => void;
  handleDumpConsoleLogs: () => void;
  handleToggleVimMode: () => void;
  handleTogglePrefixOnly: () => void;
  handleRefreshHostColors: () => void;
}

export function createConfigActions(deps: ConfigActionsDeps): ConfigActions {
  const { config, terminal, renderer } = deps;

  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  const handleDumpConsoleLogs = () => {
    const result = errore.try<void, FileSystemError>({
      try: () => {
        const logs = renderer.console.getCachedLogs();
        const timestamp = Date.now();
        const filename = `openmux-console-${timestamp}.log`;
        const filepath = path.join(os.tmpdir(), filename);
        fs.writeFileSync(filepath, logs, 'utf8');
        console.info(`Console logs dumped to: ${filepath}`);
      },
      catch: (cause) =>
        new FileSystemError({
          operation: 'write',
          path: os.tmpdir(),
          reason: `Failed to dump console logs: ${String(cause)}`,
          cause,
        }),
    });
    if (result instanceof FileSystemError) {
      console.error(result.message, result.cause);
    }
  };

  const handleToggleVimMode = () => {
    const current = config.config().keyboard.vimMode;
    const next = current === 'overlays' ? 'off' : 'overlays';
    setKeyboardVimMode(next);
    config.reloadConfig();
  };

  const handleTogglePrefixOnly = () => {
    const current = config.config().keyboard.prefixOnly;
    setKeyboardPrefixOnly(!current);
    config.reloadConfig();
  };

  const handleRefreshHostColors = () => {
    terminal.refreshHostColors({ forceApply: true }).catch((error: unknown) => {
      console.warn('[openmux] Failed to refresh host colors:', error);
    });
  };

  return {
    handleToggleConsole,
    handleDumpConsoleLogs,
    handleToggleVimMode,
    handleTogglePrefixOnly,
    handleRefreshHostColors,
  };
}
