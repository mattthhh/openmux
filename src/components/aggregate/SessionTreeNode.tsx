/**
 * SessionTreeNode - Session header component for tree-based aggregate view
 * Clean header without tree glyphs - sessions stand independently
 */

import type { AggregateTheme } from '../../core/types';

export interface SessionTreeNodeProps {
  /** Session name to display */
  sessionName: string;
  /** Number of panes in this session */
  paneCount: number;
  /** Whether this session is currently selected */
  isSelected?: boolean;
  /** Whether this session is the currently active session */
  isActive?: boolean;
  /** Whether this session is expanded */
  isExpanded?: boolean;
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
  /** Click handler */
  onClick?: () => void;
  /** Mouse down handler (used for drag start) */
  onMouseDown?: () => void;
  /** Mouse up handler (used for drop/click separation) */
  onMouseUp?: () => void;
  /** Whether this session is the current drop target */
  isDropTarget?: boolean;
  /** Whether this session is being dragged */
  isDragging?: boolean;
}

/**
 * Session header row - clean look without tree glyphs
 * Format: ▶ [sessionName] ([paneCount])
 */
export function SessionTreeNode(props: SessionTreeNodeProps) {
  const selectionColors = () => props.aggregateTheme.selection;

  // Active session gets bright blue, selected gets selection color
  const fgColor = () => {
    if (props.isSelected) return selectionColors().foreground;
    if (props.isDragging) return props.textColors.muted;
    if (props.isActive) return '#60a5fa'; // Blue-400 for active session
    return props.textColors.foreground;
  };
  const bgColor = () => {
    if (props.isSelected) return selectionColors().background;
    if (props.isDropTarget) return selectionColors().background;
    return undefined;
  };
  const mutedColor = () => (props.isSelected ? selectionColors().dim : props.textColors.muted);
  const subtleColor = () => (props.isSelected ? selectionColors().dim : props.textColors.subtle);

  // Build the display text
  const sessionLabel = () => props.sessionName;
  const paneCountText = () => `(${props.paneCount})`;
  const expandIcon = () => (props.isExpanded ? '▼' : '▶');

  // Calculate layout - NO indent, NO treePrefix for sessions
  const expandIconWidth = () => expandIcon().length + 1; // icon + space
  const paneCountWidth = () => paneCountText().length;
  const spacing = 1;

  // Available width for session name
  const availableNameWidth = () => props.maxWidth - expandIconWidth() - paneCountWidth() - spacing;

  // Truncate session name if needed
  const displayName = () => {
    const name = sessionLabel();
    if (name.length <= availableNameWidth()) return name;
    return name.slice(0, availableNameWidth() - 1) + '…';
  };

  const handleMouseDown = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onMouseDown?.();
  };

  const handleMouseUp = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onMouseUp?.();
  };

  return (
    <box
      style={{ height: 1, width: props.maxWidth, flexDirection: 'row' }}
      backgroundColor={bgColor()}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      {/* Expand/collapse indicator - NO tree glyph for sessions */}
      <text fg={subtleColor()} selectable={false}>
        {expandIcon()}{' '}
      </text>
      {/* Session name */}
      <text fg={fgColor()} selectable={false}>
        {displayName()}
      </text>
      {/* Pane count in muted color */}
      <text fg={mutedColor()} selectable={false}>
        {' '}
        {paneCountText()}
      </text>
    </box>
  );
}
