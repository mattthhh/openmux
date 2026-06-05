/**
 * PreviewPane - Right-side terminal preview component for AggregateView.
 *
 * Displays an interactive terminal preview with mouse support, selection,
 * and proper border styling based on mode.
 */

import { type Component } from 'solid-js';
import type { MouseEvent as OpenTUIMouseEvent } from '@opentui/core';
import type { Theme } from '../../contexts/ThemeContext';
import type { InteractivePreviewProps } from './InteractivePreview';

/** Mouse handler functions from createAggregateMouseHandlers */
interface PreviewMouseHandlers {
  handlePreviewMouseDown: (e: OpenTUIMouseEvent) => void;
  handlePreviewMouseUp: (e: OpenTUIMouseEvent) => void;
  handlePreviewMouseMove: (e: OpenTUIMouseEvent) => void;
  handlePreviewMouseDrag: (e: OpenTUIMouseEvent) => void;
  handlePreviewMouseScroll: (e: OpenTUIMouseEvent) => void;
  cleanup: () => void;
}

/** Props for the PreviewPane component */
interface PreviewPaneProps {
  /** Theme for styling */
  theme: Theme;
  /** Layout dimensions */
  width: number;
  height: number;
  /** Inner content dimensions (accounting for borders) */
  innerWidth: number;
  innerHeight: number;
  /** Whether in preview mode (affects interactivity and border) */
  isPreviewMode: boolean;
  /** Whether preview is zoomed */
  isZoomed: boolean;
  /** Whether copy mode is active in the preview */
  isCopyModeActive: boolean;
  /** Selected PTY ID to preview */
  selectedPtyId: string | null;
  /** X offset for mouse coordinates (list pane width + border) */
  offsetX: number;
  /** Y offset for mouse coordinates */
  offsetY: number;
  /** Mouse handlers from createAggregateMouseHandlers */
  mouseHandlers: PreviewMouseHandlers;
  /** Callback when preview is clicked to enter preview mode */
  onEnterPreview: () => void;
  /** Component renderer (injected for tree-shaking and testing) */
  components: {
    InteractivePreview: Component<InteractivePreviewProps>;
  };
}

/**
 * PreviewPane component - Displays the terminal preview with mouse support.
 */
export const PreviewPane: Component<PreviewPaneProps> = (props) => {
  // Determine border color based on state
  const borderColor = () => {
    if (!props.isPreviewMode) {
      return props.theme.pane.borderColor;
    }
    if (props.isCopyModeActive) {
      return props.theme.pane.copyModeBorderColor;
    }
    return props.theme.pane.focusedBorderColor;
  };

  // Handle mouse down - enter preview mode if not already in it
  const handleMouseDown = (e: OpenTUIMouseEvent) => {
    if (!props.isPreviewMode) {
      e.preventDefault();
      props.onEnterPreview();
      return;
    }
    props.mouseHandlers.handlePreviewMouseDown(e);
  };

  return (
    <box
      style={{
        width: props.width,
        height: props.height,
        border: true,
        borderStyle: 'single',
        borderColor: borderColor(),
      }}
      backgroundColor="transparent"
      onMouseDown={handleMouseDown}
      onMouseUp={props.mouseHandlers.handlePreviewMouseUp}
      onMouseMove={props.mouseHandlers.handlePreviewMouseMove}
      onMouseDrag={props.mouseHandlers.handlePreviewMouseDrag}
      onMouseScroll={props.mouseHandlers.handlePreviewMouseScroll}
    >
      <props.components.InteractivePreview
        ptyId={props.selectedPtyId}
        width={props.innerWidth}
        height={props.innerHeight}
        isInteractive={props.isPreviewMode}
        offsetX={props.offsetX}
        offsetY={props.offsetY}
      />
    </box>
  );
};

export type { PreviewPaneProps, PreviewMouseHandlers };
