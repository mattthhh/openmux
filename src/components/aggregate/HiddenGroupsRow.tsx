/**
 * HiddenGroupsRow - Clickable indicator for revealing hidden session groups
 *
 * Displayed at the bottom of the aggregate list when there are hidden groups.
 * Clicking it reveals all hidden session groups.
 */

import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { AggregateTheme } from '../../core/types';

export interface HiddenGroupsRowProps {
  /** Number of hidden session groups */
  count: number;
  /** Whether this row is selected */
  isSelected?: boolean;
  /** Max width available for rendering */
  maxWidth: number;
  /** Theme colors */
  aggregateTheme: AggregateTheme;
  /** Text colors from overlay */
  textColors: {
    foreground: string;
    muted: string;
    subtle: string;
  };
  /** Selection handler (fires on mouseDown for immediate visual feedback) */
  onSelect?: () => void;
  /** Action handler to reveal hidden groups (fires on mouseUp to avoid click-through) */
  onAction?: () => void;
}

/**
 * Hidden groups indicator row
 * Format: ▸ Show N hidden group(s)
 */
export function HiddenGroupsRow(props: HiddenGroupsRowProps) {
  const selectionColors = () => props.aggregateTheme.selection;

  const fgColor = () => {
    if (props.isSelected) return selectionColors().foreground;
    return props.textColors.subtle;
  };

  const bgColor = () => {
    if (props.isSelected) return selectionColors().background;
    return undefined;
  };

  const label = () => {
    const groupWord = props.count === 1 ? 'group' : 'groups';
    return `▸ Show ${props.count} hidden ${groupWord}`;
  };

  const handleMouseDown = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onSelect?.();
  };

  const handleMouseUp = (event: OpenTUIMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onAction?.();
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <text fg={fgColor()} selectable={false}>
        {label()}
      </text>
    </box>
  );
}
