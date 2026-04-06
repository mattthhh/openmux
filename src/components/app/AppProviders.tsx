/**
 * Provider stack for the App component.
 */

import type { JSX } from 'solid-js';
import {
  ConfigProvider,
  useConfig,
  ThemeProvider,
  LayoutProvider,
  KeyboardProvider,
  TerminalProvider,
  OverlayProvider,
} from '../../contexts';
import { SelectionProvider } from '../../contexts/SelectionContext';
import { CopyModeProvider } from '../../contexts/copy-mode';
import { SearchProvider } from '../../contexts/SearchContext';
import { AggregateViewProvider } from '../../contexts/AggregateViewContext';
import { TitleProvider } from '../../contexts/TitleContext';
import { SessionBridge } from '../SessionBridge';

interface AppProvidersProps {
  children: JSX.Element;
}

export function AppProviders(props: AppProvidersProps) {
  return (
    <ConfigProvider>
      <ConfiguredProviders>{props.children}</ConfiguredProviders>
    </ConfigProvider>
  );
}

function ConfiguredProviders(props: AppProvidersProps) {
  const config = useConfig();
  const currentConfig = () => config.config();

  return (
    <ThemeProvider theme={currentConfig().theme}>
      <LayoutProvider config={currentConfig().layout}>
        <KeyboardProvider>
          <TitleProvider>
            <TerminalProvider>
              <SelectionProvider>
                <CopyModeProvider>
                  <SearchProvider>
                    <SessionBridge>
                      <AggregateViewProvider>
                        <OverlayProvider>{props.children}</OverlayProvider>
                      </AggregateViewProvider>
                    </SessionBridge>
                  </SearchProvider>
                </CopyModeProvider>
              </SelectionProvider>
            </TerminalProvider>
          </TitleProvider>
        </KeyboardProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
