/**
 * Theme context for styling configuration
 */

import { createContext, useContext, type ParentProps } from 'solid-js';
import type { Theme } from '../core/types';
import { DEFAULT_THEME } from '../core/config';

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

interface ThemeProviderProps extends ParentProps {
  theme?: Partial<Theme>;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const uiOverrides = props.theme?.ui;
  const mergedTheme: Theme = {
    pane: { ...DEFAULT_THEME.pane, ...props.theme?.pane },
    statusBar: { ...DEFAULT_THEME.statusBar, ...props.theme?.statusBar },
    ui: {
      mutedText: uiOverrides?.mutedText ?? DEFAULT_THEME.ui.mutedText,
      listSelection: { ...DEFAULT_THEME.ui.listSelection, ...uiOverrides?.listSelection },
      buttonFocus: { ...DEFAULT_THEME.ui.buttonFocus, ...uiOverrides?.buttonFocus },
      copyNotification: { ...DEFAULT_THEME.ui.copyNotification, ...uiOverrides?.copyNotification },
      copyMode: {
        selection: { ...DEFAULT_THEME.ui.copyMode.selection, ...uiOverrides?.copyMode?.selection },
        cursor: { ...DEFAULT_THEME.ui.copyMode.cursor, ...uiOverrides?.copyMode?.cursor },
      },
      aggregate: {
        selection: {
          ...DEFAULT_THEME.ui.aggregate.selection,
          ...uiOverrides?.aggregate?.selection,
        },
        diff: { ...DEFAULT_THEME.ui.aggregate.diff, ...uiOverrides?.aggregate?.diff },
      },
    },
    searchAccentColor: props.theme?.searchAccentColor ?? DEFAULT_THEME.searchAccentColor,
  };

  return <ThemeContext.Provider value={mergedTheme}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return theme;
}

export type { Theme } from '../core/types';
