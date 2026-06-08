export {
  getCellColors,
  renderRow,
  renderRowDirect,
  DEFAULT_BG_SENTINEL,
  SENTINEL_BG_R,
  SENTINEL_BG_G,
  SENTINEL_BG_B,
  SELECTION_FG_RGB,
  SELECTION_BG_RGB,
  SEARCH_MATCH_FG_RGB,
  SEARCH_MATCH_BG_RGB,
  SEARCH_CURRENT_FG_RGB,
  SEARCH_CURRENT_BG_RGB,
  WHITE_RGB,
  rgb8,
  type CellRenderingDeps,
  type CellRenderingOptions,
} from './cell-rendering';

export { renderScrollbar, renderScrollDepth, type ScrollbarOptions } from './scrollbar';

export {
  fetchRowsForRendering,
  calculatePrefetchRequest,
  type RowFetchingOptions,
  type RowFetchResult,
  type PrefetchRequest,
} from './row-fetching';

export {
  guardScrollbackRender,
  type ScrollbackGuardOptions,
  type ScrollbackGuardResult,
} from './scrollback-guard';
