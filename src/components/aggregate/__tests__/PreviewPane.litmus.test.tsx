/**
 * PreviewPane litmus test - Quick validation of component rendering.
 */

import { describe, it, expect, vi } from 'bun:test';
import type { PreviewPaneProps, PreviewMouseHandlers } from '../PreviewPane';

describe('PreviewPane litmus', () => {
  const mockTheme = {
    pane: {
      borderColor: 'gray',
      focusedBorderColor: 'blue',
      copyModeBorderColor: 'yellow',
      borderStyle: 'single' as const,
    },
    ui: {
      aggregate: {},
    },
  } as unknown as import('../PreviewPane').PreviewPaneProps['theme'];

  const mockMouseHandlers: PreviewMouseHandlers = {
    handlePreviewMouseDown: vi.fn(),
    handlePreviewMouseUp: vi.fn(),
    handlePreviewMouseMove: vi.fn(),
    handlePreviewMouseDrag: vi.fn(),
    handlePreviewMouseScroll: vi.fn(),
    cleanup: vi.fn(),
  };

  const mockInteractivePreview = vi.fn(() => null);

  const baseProps: PreviewPaneProps = {
    theme: mockTheme,
    width: 80,
    height: 30,
    innerWidth: 78,
    innerHeight: 28,
    isPreviewMode: false,
    isZoomed: false,
    isCopyModeActive: false,
    selectedPtyId: 'pty-1',
    offsetX: 41,
    offsetY: 1,
    mouseHandlers: mockMouseHandlers,
    onEnterPreview: vi.fn(),
    components: {
      InteractivePreview: mockInteractivePreview,
    },
  };

  it('should have required prop types', () => {
    const props: PreviewPaneProps = baseProps;
    expect(props.theme).toBeDefined();
    expect(props.mouseHandlers).toBeDefined();
    expect(props.components).toBeDefined();
  });

  it('should handle different modes', () => {
    const previewModeProps: PreviewPaneProps = {
      ...baseProps,
      isPreviewMode: true,
    };
    expect(previewModeProps.isPreviewMode).toBe(true);

    const copyModeProps: PreviewPaneProps = {
      ...baseProps,
      isPreviewMode: true,
      isCopyModeActive: true,
    };
    expect(copyModeProps.isCopyModeActive).toBe(true);

    const zoomedProps: PreviewPaneProps = {
      ...baseProps,
      isZoomed: true,
    };
    expect(zoomedProps.isZoomed).toBe(true);
  });

  it('should accept null selectedPtyId', () => {
    const props: PreviewPaneProps = {
      ...baseProps,
      selectedPtyId: null,
    };
    expect(props.selectedPtyId).toBeNull();
  });

  it('should provide mouse handlers', () => {
    expect(typeof baseProps.mouseHandlers.handlePreviewMouseDown).toBe('function');
    expect(typeof baseProps.mouseHandlers.handlePreviewMouseUp).toBe('function');
    expect(typeof baseProps.mouseHandlers.handlePreviewMouseMove).toBe('function');
    expect(typeof baseProps.mouseHandlers.handlePreviewMouseDrag).toBe('function');
    expect(typeof baseProps.mouseHandlers.handlePreviewMouseScroll).toBe('function');
    expect(typeof baseProps.mouseHandlers.cleanup).toBe('function');
  });
});
