/**
 * Error definitions for aggregate view operations.
 */

import * as errore from 'errore';

export class SelectionOperationError extends errore.createTaggedError({
  name: 'SelectionOperationError',
  message: 'Selection operation failed: $reason',
}) {}
