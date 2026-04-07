import type { Accessor } from 'solid-js';

import type { TerminalState } from '../../../core/types';
import type { Workspaces } from '../../../core/operations/layout-actions';
import type { ITerminalEmulator } from '../../../terminal/emulator-interface';
import type { FlattenedTreeItem, PtyInfo } from '../../../contexts/aggregate-view-types';
import { isSavedAggregatePtyId } from '../../../contexts/aggregate/rows';
import { getAggregateSessionForPty } from '../../../effect/bridge/aggregate/cache/session-pty-cache';

import { resolveAggregatePreviewPtyId, resolveAggregatePtyOwnership } from '../utils';
import { useActivitySubscriptions } from './useActivitySubscriptions';
import { useEmulatorCache } from './useEmulatorCache';

interface AggregatePreviewSupportParams {
  isActive: Accessor<boolean>;
  getSelectedPtyId: Accessor<string | null>;
  getSelectedIndex: Accessor<number>;
  getFlattenedTree: Accessor<FlattenedTreeItem[]>;
  getTrackedPtys: Accessor<PtyInfo[]>;
  getActiveSessionId: Accessor<string | null>;
  getWorkspaces: Accessor<Workspaces>;
  findSessionForPty: (ptyId: string) => { sessionId: string; paneId: string } | null;
  getEmulatorSync: (ptyId: string) => ITerminalEmulator | null;
  getTerminalStateSync: (ptyId: string) => TerminalState | null;
  isMouseTrackingEnabled: (ptyId: string) => boolean;
}

/**
 * Shared aggregate preview helpers.
 *
 * This hook centralizes the three pieces of behavior that must agree with each other:
 * - which PTY the preview should attach to,
 * - how saved rows resolve back to live PTYs,
 * - how background activity should keep saved rows shimmering.
 *
 * Keeping those rules in one place avoids subtle drift between preview rendering,
 * keyboard input, and activity tracking.
 */
export function useAggregatePreviewSupport(params: AggregatePreviewSupportParams) {
  const getPreviewableSelectedPtyId = () =>
    resolveAggregatePreviewPtyId({
      selectedPtyId: params.getSelectedPtyId(),
      selectedIndex: params.getSelectedIndex(),
      flattenedTree: params.getFlattenedTree(),
      activeSessionId: params.getActiveSessionId(),
      workspaces: params.getWorkspaces(),
    });

  const emulatorCache = useEmulatorCache({
    isActive: params.isActive,
    getSelectedPtyId: getPreviewableSelectedPtyId,
  });

  useActivitySubscriptions({
    isActive: params.isActive,
    getTrackedPtys: params.getTrackedPtys,
    resolvePtyOwnership: (ptyId) =>
      resolveAggregatePtyOwnership({
        ptyId,
        workspaces: params.getWorkspaces(),
        activeSessionId: params.getActiveSessionId(),
        trackedOwner: params.findSessionForPty(ptyId),
        aggregateOwner: getAggregateSessionForPty(ptyId),
      }),
  });

  const getAggregateEmulatorSync = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return null;
    }

    return emulatorCache.get(ptyId) ?? params.getEmulatorSync(ptyId);
  };

  const getAggregateTerminalStateSync = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return null;
    }

    return (
      getAggregateEmulatorSync(ptyId)?.getTerminalState() ?? params.getTerminalStateSync(ptyId)
    );
  };

  const isAggregateMouseTrackingEnabled = (ptyId: string) => {
    if (isSavedAggregatePtyId(ptyId)) {
      return false;
    }

    return (
      getAggregateEmulatorSync(ptyId)?.isMouseTrackingEnabled() ??
      params.isMouseTrackingEnabled(ptyId)
    );
  };

  return {
    getPreviewableSelectedPtyId,
    getAggregateEmulatorSync,
    getAggregateTerminalStateSync,
    isAggregateMouseTrackingEnabled,
  };
}
