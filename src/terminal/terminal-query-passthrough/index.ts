/**
 * Terminal Query Passthrough Module
 *
 * Intercepts terminal queries from PTY output and generates appropriate responses.
 */

export { TerminalQueryPassthrough } from './passthrough';

export type { TerminalQuery, QueryParseResult, QueryType } from './types';

export { parseTerminalQueries, mightContainQueries } from './parser';

export * from './responses';

export * from './constants';
