/**
 * Action handler modules for the app layer.
 *
 * Each module encapsulates a focused domain of action handlers,
 * reducing the monolithic `app-actions.ts` into composable pieces.
 */

export {
  createCopyModeActions,
  type CopyModeActions,
  type CopyModeActionsDeps,
} from './copy-mode-actions';
export { createSearchActions, type SearchActions, type SearchActionsDeps } from './search-actions';
export { createOpenerActions, type OpenerActions, type OpenerActionsDeps } from './opener-actions';
export { createConfigActions, type ConfigActions, type ConfigActionsDeps } from './config-actions';
export type { AggregateCommandActions } from './types';
