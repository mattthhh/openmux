/**
 * Error definitions for aggregate view operations.
 */

import * as errore from 'errore';

/** Error when tree operations fail */
export class TreeOperationError extends errore.createTaggedError({
  name: 'TreeOperationError',
  message: 'Tree operation $operation failed: $reason',
}) {}

/** Error when filtering operations fail */
export class FilterOperationError extends errore.createTaggedError({
  name: 'FilterOperationError',
  message: 'Filter operation failed: $reason',
}) {}

/** Error when selection operations fail */
export class SelectionOperationError extends errore.createTaggedError({
  name: 'SelectionOperationError',
  message: 'Selection operation failed: $reason',
}) {}

/** Error when session operations fail */
export class SessionOperationError extends errore.createTaggedError({
  name: 'SessionOperationError',
  message: 'Session operation $operation failed: $reason',
}) {}

/** Union type for all aggregate view errors */
export type AggregateViewError =
  | TreeOperationError
  | FilterOperationError
  | SelectionOperationError
  | SessionOperationError;
