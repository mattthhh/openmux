/**
 * Git metadata utilities for Aggregate View.
 *
 * Exports:
 * - GitMetadataFields type for applying git data to PTY info
 * - extractGitMetadata for converting GitRepoMetadata
 * - Comparison utilities (areGitDiffStatsEqual, didPtyInfoChange)
 */

// Types
export type { GitMetadataFields } from './types';

// Extraction and comparison
export {
  extractGitMetadata,
  applyGitMetadataSnapshot,
  areGitDiffStatsEqual,
  hasGitMetadata,
  mergePtyInfoPreservingGitMetadata,
  didPtyInfoChange,
} from './metadata';
