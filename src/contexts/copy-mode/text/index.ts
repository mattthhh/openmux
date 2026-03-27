/**
 * Text extraction module for copy mode
 */

export {
  TextExtractionError,
  createLineAccessor,
  extractBlockText,
  extractBlockTextByChunks,
  extractRangeText,
  extractRangeTextByChunks,
  extractLineAtCursor,
  prepareCopyText,
  type CopyResult,
} from './extraction';
