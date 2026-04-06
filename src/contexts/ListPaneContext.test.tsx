import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { createSignal } from 'solid-js';

import type { FlattenedTreeItem } from './aggregate-view-types';
import type { SessionMetadata } from '../effect/models';

mock.module('./ThemeContext', () => ({
  useTheme: () => ({
    pane: {
      borderColor: '#333333',
      focusedBorderColor: '#ffffff',
      copyModeBorderColor: '#00ff00',
    },
    ui: {
      aggregate: {
        selection: {
          foreground: '#ffffff',
          background: '#2563eb',
          dim: '#93c5fd',
        },
        diff: {
          added: '#00ff00',
          addedSelected: '#00ff00',
          removed: '#ff0000',
          removedSelected: '#ff0000',
        },
      },
    },
  }),
}));

mock.module('../components/overlay-colors', () => ({
  useOverlayColors: () => ({
    foreground: () => '#ffffff',
    muted: () => '#999999',
    subtle: () => '#666666',
  }),
}));

let createListPaneContextValue: typeof import('./ListPaneContext').createListPaneContextValue;

function createSession(sessionId: string, name = sessionId): SessionMetadata {
  return {
    id: sessionId,
    name,
    createdAt: 1,
    lastSwitchedAt: 1,
    autoNamed: false,
  };
}

function createSessionItem(index: number, sessionId: string): FlattenedTreeItem {
  return {
    node: {
      type: 'session',
      session: createSession(sessionId),
      ptyCount: 1,
      activePtyCount: 1,
      loadState: { status: 'loaded' },
      isExpanded: true,
    },
    depth: 0,
    isLast: true,
    prefix: '',
    index,
    parentSessionId: undefined,
  };
}

const selectionHandlers = {
  onSelectItem: () => {},
  onSelectPty: () => {},
  onToggleSession: () => {},
};

const dragHandlers = {
  onBeginSessionDrag: () => {},
  onEndSessionDrag: () => {},
  onUpdateDragTarget: () => {},
  onCommitDrag: () => {},
  getItemAtMouse: () => undefined,
};

const scrollHandlers = {
  onScrollUp: () => {},
  onScrollDown: () => {},
  onExitPreview: () => {},
  onPlaceholderClick: () => {},
};

beforeAll(async () => {
  const module = await import('./ListPaneContext');
  createListPaneContextValue = module.createListPaneContextValue;
});

describe('ListPaneContext', () => {
  it('keeps list selection and preview state reactive for consumers', () => {
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [isPreviewMode, setIsPreviewMode] = createSignal(false);
    const [flattenedTree, setFlattenedTree] = createSignal<FlattenedTreeItem[]>([
      createSessionItem(0, 'session-a'),
    ]);

    const ctx = createListPaneContextValue({
      get layout() {
        return { width: 40, height: 20, innerWidth: 38, innerHeight: 18 };
      },
      get viewport() {
        return {
          start: 0,
          end: flattenedTree().length,
          visibleCount: flattenedTree().length,
          showTopIndicator: false,
          showBottomIndicator: false,
          hiddenAboveCount: 0,
          hiddenBelowCount: 0,
        };
      },
      get state() {
        return {
          flattenedTree: flattenedTree(),
          selectedIndex: selectedIndex(),
          activeSessionId: 'session-a',
          draggingSessionId: null,
          dragTargetSessionId: null,
          isPreviewMode: isPreviewMode(),
        };
      },
      get selectionHandlers() {
        return selectionHandlers;
      },
      get dragHandlers() {
        return dragHandlers;
      },
      get scrollHandlers() {
        return scrollHandlers;
      },
      get shimmerTargetColor() {
        return '#000000';
      },
      children: undefined,
    });

    expect(ctx.state.selectedIndex).toBe(0);
    expect(ctx.state.flattenedTree).toHaveLength(1);
    expect(ctx.state.isPreviewMode).toBe(false);

    setFlattenedTree([createSessionItem(0, 'session-a'), createSessionItem(1, 'session-b')]);
    setSelectedIndex(1);
    setIsPreviewMode(true);

    expect(ctx.state.selectedIndex).toBe(1);
    expect(ctx.state.flattenedTree).toHaveLength(2);
    expect(ctx.state.isPreviewMode).toBe(true);
  });

  it('keeps layout and viewport reactive for list hit testing and borders', () => {
    const [innerWidth, setInnerWidth] = createSignal(38);
    const [viewportStart, setViewportStart] = createSignal(0);

    const ctx = createListPaneContextValue({
      get layout() {
        return { width: 40, height: 20, innerWidth: innerWidth(), innerHeight: 18 };
      },
      get viewport() {
        return {
          start: viewportStart(),
          end: viewportStart() + 3,
          visibleCount: 3,
          showTopIndicator: viewportStart() > 0,
          showBottomIndicator: false,
          hiddenAboveCount: viewportStart(),
          hiddenBelowCount: 0,
        };
      },
      get state() {
        return {
          flattenedTree: [createSessionItem(0, 'session-a')],
          selectedIndex: 0,
          activeSessionId: 'session-a',
          draggingSessionId: null,
          dragTargetSessionId: null,
          isPreviewMode: false,
        };
      },
      get selectionHandlers() {
        return selectionHandlers;
      },
      get dragHandlers() {
        return dragHandlers;
      },
      get scrollHandlers() {
        return scrollHandlers;
      },
      get shimmerTargetColor() {
        return '#000000';
      },
      children: undefined,
    });

    expect(ctx.layout.innerWidth).toBe(38);
    expect(ctx.viewport.start).toBe(0);

    setInnerWidth(52);
    setViewportStart(4);

    expect(ctx.layout.innerWidth).toBe(52);
    expect(ctx.viewport.start).toBe(4);
  });
});
