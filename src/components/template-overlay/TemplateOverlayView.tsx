import { Show, For } from 'solid-js';
import type { TemplateSession } from '../../effect/models';
import { formatComboSet, type ResolvedKeybindingMap } from '../../core/keybindings';
import type { VimInputMode } from '../../core/vim-sequences';
import type { TemplateTabMode } from './keyboard';
import { fitLabel, formatRelativeTime, truncate } from './formatting';
import { useTheme } from '../../contexts/ThemeContext';
import { useOverlayColors } from '../overlay-colors';
import { truncateHint } from '../overlay-hints';
import { getTemplateStats, type SaveSummaryLine } from './summary';

interface TemplateOverlayViewProps {
  show: boolean;
  tab: TemplateTabMode;
  overlayWidth: number;
  overlayHeight: number;
  overlayX: number;
  overlayY: number;
  accentColor: string;
  templates: TemplateSession[];
  visibleTemplates: TemplateSession[];
  listOffset: number;
  selectedIndex: number;
  saveIndent: string;
  saveIndentWidth: number;
  saveName: string;
  error: string | null;
  paneLabelWidth: number;
  visibleSaveSummaryLines: SaveSummaryLine[];
  saveSummaryTruncated: boolean;
  vimEnabled: boolean;
  vimMode: VimInputMode;
  applyBindings: ResolvedKeybindingMap;
  saveBindings: ResolvedKeybindingMap;
}

const HORIZONTAL = '\u2500';

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function TemplateOverlayView(props: TemplateOverlayViewProps) {
  const theme = useTheme();
  const {
    background: overlayBg,
    foreground: overlayFg,
    subtle: overlaySubtle,
    separator: overlaySeparator,
  } = useOverlayColors();
  const renderSaveLine = (line: SaveSummaryLine) => {
    const maxWidth = Math.max(1, props.overlayWidth - 4);
    if (line.type === 'text') {
      return (
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg={overlaySubtle()}>{truncate(`${props.saveIndent}${line.value}`, maxWidth)}</text>
        </box>
      );
    }

    const prefix = `${props.saveIndent}${line.prefix}`;
    const suffix = ` [${line.cwdTail}]`;
    const available = maxWidth - prefix.length - suffix.length;
    if (available <= 0) {
      const fallback = `${prefix}${line.label}${suffix}`;
      return (
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg={overlaySubtle()}>{truncate(fallback, maxWidth)}</text>
        </box>
      );
    }

    const labelWidth = Math.min(props.paneLabelWidth, available);
    const labelText = fitLabel(line.label, labelWidth);
    return (
      <box style={{ flexDirection: 'row', height: 1 }}>
        <text fg={overlaySubtle()}>{prefix}</text>
        <text fg={line.hasProcess ? overlayFg() : overlaySubtle()}>{labelText}</text>
        <text fg={overlaySubtle()}>{suffix}</text>
      </box>
    );
  };

  const renderTemplateRow = (template: TemplateSession, index: number) => {
    const selected = index === props.selectedIndex;
    const maxWidth = Math.max(1, props.overlayWidth - 4);
    const stats = getTemplateStats(template);
    const ws = `${stats.workspaceCount}ws`.padEnd(4);
    const panes = `${stats.paneCount}p`.padEnd(3);
    const timeWidth = Math.min(12, Math.max(8, maxWidth - 20));
    const time = truncate(formatRelativeTime(template.createdAt), timeWidth);
    const nameWidth = Math.max(1, Math.min(24, maxWidth - (12 + timeWidth)));
    const name = truncate(template.name, nameWidth);
    const line = `  ${name} ${ws} ${panes} ${time}`;
    const color = selected ? theme.ui.listSelection.foreground : overlayFg();
    const bg = selected ? theme.ui.listSelection.background : undefined;
    return (
      <text fg={color} bg={bg}>
        {truncate(line, maxWidth)}
      </text>
    );
  };

  const renderTab = (label: string, active: boolean) => (
    <text
      fg={active ? theme.ui.listSelection.foreground : overlaySubtle()}
      bg={active ? theme.ui.listSelection.background : undefined}
    >
      {` ${label} `}
    </text>
  );

  const applyHints = () => {
    if (props.vimEnabled) {
      const modeHint = props.vimMode === 'insert' ? 'esc:normal' : 'i:insert';
      return `j/k:nav gg/G:jump enter:apply dd:del tab:save q:close ${modeHint}`;
    }
    const nav = formatComboSet([
      ...getCombos(props.applyBindings, 'template.list.up'),
      ...getCombos(props.applyBindings, 'template.list.down'),
    ]);
    const apply = formatComboSet(getCombos(props.applyBindings, 'template.apply'));
    const remove = formatComboSet(getCombos(props.applyBindings, 'template.delete'));
    const save = formatComboSet(getCombos(props.applyBindings, 'template.tab.save'));
    const close = formatComboSet(getCombos(props.applyBindings, 'template.close'));
    return `${nav}:nav ${apply}:apply ${remove}:delete ${save}:save ${close}:close`;
  };

  const saveHints = () => {
    if (props.vimEnabled) {
      const modeHint = props.vimMode === 'insert' ? 'esc:normal' : 'i:insert';
      return `enter:save tab:apply q:close ${modeHint}`;
    }
    const apply = formatComboSet(getCombos(props.saveBindings, 'template.tab.apply'));
    const save = formatComboSet(getCombos(props.saveBindings, 'template.save'));
    const close = formatComboSet(getCombos(props.saveBindings, 'template.close'));
    return `${apply}:apply ${save}:save ${close}:close`;
  };

  const emptyApplyHints = () => {
    if (props.vimEnabled) {
      return 'tab:save q:close';
    }
    const save = formatComboSet(getCombos(props.applyBindings, 'template.tab.save'));
    const close = formatComboSet(getCombos(props.applyBindings, 'template.close'));
    return `${save}:save ${close}:close`;
  };

  const hintWidth = () => Math.max(1, props.overlayWidth - 4);
  const applyHintDisplay = () =>
    truncateHint(props.templates.length === 0 ? emptyApplyHints() : applyHints(), hintWidth());
  const saveHintDisplay = () => truncateHint(props.error ?? saveHints(), hintWidth());

  return (
    <Show when={props.show}>
      <box
        style={{
          position: 'absolute',
          left: props.overlayX,
          top: props.overlayY,
          width: props.overlayWidth,
          height: props.overlayHeight,
          border: true,
          borderStyle: 'rounded',
          borderColor: props.accentColor,
          paddingLeft: 1,
          paddingRight: 1,
          zIndex: 120,
        }}
        backgroundColor={overlayBg()}
        title=" Templates "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          <box style={{ flexDirection: 'row', height: 1 }}>
            {renderTab('Apply', props.tab === 'apply')}
            <text fg={overlaySeparator()}>{'  '}</text>
            {renderTab('Save', props.tab === 'save')}
          </box>

          <box style={{ height: 1 }}>
            <text fg={overlaySeparator()}>{HORIZONTAL.repeat(props.overlayWidth - 4)}</text>
          </box>

          <Show
            when={props.tab === 'apply'}
            fallback={
              <box style={{ flexDirection: 'column' }}>
                <box style={{ height: 1, flexDirection: 'row' }}>
                  <text fg={overlaySubtle()}>{props.saveIndent}Name: </text>
                  <text fg={overlayFg()}>
                    {truncate(
                      `${props.saveName}_`,
                      Math.max(1, props.overlayWidth - 4 - props.saveIndentWidth - 'Name: '.length)
                    )}
                  </text>
                </box>
                <For each={props.visibleSaveSummaryLines}>{(line) => renderSaveLine(line)}</For>
                <Show when={props.saveSummaryTruncated}>
                  <box style={{ height: 1 }}>
                    <text fg={overlaySubtle()}>...</text>
                  </box>
                </Show>
                <box style={{ height: 1 }}>
                  <text fg={overlaySeparator()}>{HORIZONTAL.repeat(props.overlayWidth - 4)}</text>
                </box>
                <box style={{ height: 1 }}>
                  <text fg={overlaySubtle()}>{saveHintDisplay()}</text>
                </box>
              </box>
            }
          >
            <Show
              when={props.templates.length > 0}
              fallback={
                <box style={{ height: 1 }}>
                  <text fg={overlaySubtle()}> No templates saved</text>
                </box>
              }
            >
              <For each={props.visibleTemplates}>
                {(template, index) => (
                  <box style={{ height: 1 }}>
                    {renderTemplateRow(template, index() + props.listOffset)}
                  </box>
                )}
              </For>
            </Show>

            <box style={{ height: 1 }}>
              <text fg={overlaySeparator()}>{HORIZONTAL.repeat(props.overlayWidth - 4)}</text>
            </box>
            <box style={{ height: 1 }}>
              <text fg={overlaySubtle()}>{applyHintDisplay()}</text>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  );
}
