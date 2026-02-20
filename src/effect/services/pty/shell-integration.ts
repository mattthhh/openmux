/**
 * Shell integration helpers for capturing executed command lines (errore version).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir } from '../../../core/user-config';

export type ShellLaunchConfig = {
  args: string[];
  env: Record<string, string>;
};

const INTEGRATION_ENV = 'OPENMUX_SHELL_INTEGRATION';

function writeFileIfChanged(filePath: string, contents: string): void {
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === contents) return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function ensureZshIntegration(dir: string): { hookPath: string } {
  const hookPath = path.join(dir, 'openmux.zsh');
  const zshrcPath = path.join(dir, '.zshrc');
  const zshenvPath = path.join(dir, '.zshenv');

  const hook = `# openmux zsh hook (auto-generated)\n\nif [[ -n "\${OPENMUX_SHELL_HOOK_ACTIVE:-}" ]]; then\n  return 0\nfi\nOPENMUX_SHELL_HOOK_ACTIVE=1\n\nautoload -Uz add-zsh-hook 2>/dev/null\n\n__openmux_encode() {\n  local input="\$1"\n  input=\${input//%/%25}\n  input=\${input//\$'\\n'/%0A}\n  input=\${input//\$'\\r'/%0D}\n  input=\${input//\$'\\e'/%1B}\n  input=\${input//\$'\\a'/%07}\n  printf '%s' "\$input"\n}\n\n__openmux_preexec() {\n  local cmd="\$1"\n  if [[ -z "\$cmd" ]]; then\n    return\n  fi\n  local eol_mark="\${PROMPT_EOL_MARK-%}"\n  if [[ -n "\$eol_mark" && "\$cmd" == *"\$eol_mark" ]]; then\n    cmd="\${cmd%\$eol_mark}"\n  fi\n  local encoded\n  encoded=\$(__openmux_encode "\$cmd")\n  printf '\\033]777;openmux;cmd=%s\\007' "\$encoded"\n}\n\nadd-zsh-hook preexec __openmux_preexec\n`;

  const zshrc = `# openmux zshrc shim (auto-generated)\n\nOPENMUX_ZDOTDIR_ORIG="\${OPENMUX_ORIGINAL_ZDOTDIR:-\$HOME}"\nif [[ -n "\$OPENMUX_ZDOTDIR_ORIG" && "\$OPENMUX_ZDOTDIR_ORIG" != "\$ZDOTDIR" ]]; then\n  export ZDOTDIR="\$OPENMUX_ZDOTDIR_ORIG"\n  if [[ -f "\$OPENMUX_ZDOTDIR_ORIG/.zshrc" ]]; then\n    source "\$OPENMUX_ZDOTDIR_ORIG/.zshrc"\n  elif [[ -f "\$HOME/.zshrc" ]]; then\n    source "\$HOME/.zshrc"\n  fi\nelif [[ -f "\$HOME/.zshrc" && "\$ZDOTDIR" != "\$HOME" ]]; then\n  source "\$HOME/.zshrc"\nfi\n\nif [[ -n "\$${INTEGRATION_ENV}" && -f "\$${INTEGRATION_ENV}" ]]; then\n  source "\$${INTEGRATION_ENV}"\nfi\n`;

  const zshenv = `# openmux zshenv shim (auto-generated)\n\nOPENMUX_ZDOTDIR_ORIG="\${OPENMUX_ORIGINAL_ZDOTDIR:-\$HOME}"\nif [[ -n "\$OPENMUX_ZDOTDIR_ORIG" && "\$OPENMUX_ZDOTDIR_ORIG" != "\$ZDOTDIR" ]]; then\n  OPENMUX_PREV_ZDOTDIR="\$ZDOTDIR"\n  export ZDOTDIR="\$OPENMUX_ZDOTDIR_ORIG"\n  if [[ -f "\$OPENMUX_ZDOTDIR_ORIG/.zshenv" ]]; then\n    source "\$OPENMUX_ZDOTDIR_ORIG/.zshenv"\n  elif [[ -f "\$HOME/.zshenv" ]]; then\n    source "\$HOME/.zshenv"\n  fi\n  export ZDOTDIR="\$OPENMUX_PREV_ZDOTDIR"\n  unset OPENMUX_PREV_ZDOTDIR\nfi\n`;

  writeFileIfChanged(hookPath, hook);
  writeFileIfChanged(zshrcPath, zshrc);
  writeFileIfChanged(zshenvPath, zshenv);

  return { hookPath };
}

export function prepareShellIntegration(shellPath: string, baseEnv: Record<string, string>): ShellLaunchConfig {
  const hooksSetting = (baseEnv.OPENMUX_SHELL_HOOKS ?? '').toLowerCase();
  if (hooksSetting === '0' || hooksSetting === 'false') {
    return { args: [], env: baseEnv };
  }

  const shellName = path.basename(shellPath);
  if (shellName === 'zsh') {
    const baseDir = path.join(getConfigDir(), 'shell', 'zsh');
    const { hookPath } = ensureZshIntegration(baseDir);
    const originalZdotdir = baseEnv.OPENMUX_ORIGINAL_ZDOTDIR || baseEnv.ZDOTDIR || baseEnv.HOME || process.env.HOME || '';

    return {
      args: [],
      env: {
        ...baseEnv,
        OPENMUX_ORIGINAL_ZDOTDIR: originalZdotdir,
        ZDOTDIR: baseDir,
        [INTEGRATION_ENV]: hookPath,
      },
    };
  }

  return { args: [], env: baseEnv };
}
