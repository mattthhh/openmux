/**
 * Error definitions for aggregate view operations.
 */

import * as errore from 'errore';

export class TreeOperationError extends errore.createTaggedError({
  name: 'TreeOperationError',
  message: 'Tree operation $operation failed: $reason',
}) {}

export class FilterOperationError extends errore.createTaggedError({
  name: 'FilterOperationError',
  message: 'Filter operation failed: $reason',
}) {}

export class SelectionOperationError extends errore.createTaggedError({
  name: 'SelectionOperationError',
  message: 'Selection operation failed: $reason',
}) {}

export class SessionOperationError extends errore.createTaggedError({
  name: 'SessionOperationError',
  message: 'Session operation $operation failed: $reason',
}) {}
