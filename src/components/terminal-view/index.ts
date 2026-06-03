export {
  getCellColors,
  renderRow,
  renderRowDirect,
  DEFAULT_BG_SENTINEL,
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
