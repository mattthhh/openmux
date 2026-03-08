/**
 * Domain errors using errore for type-safe, tagged errors.
 * Replaces Effect Schema.TaggedError with plain error classes.
 */
import * as errore from "errore"

/** Failed to spawn a PTY process */
export class PtySpawnError extends errore.createTaggedError({
  name: "PtySpawnError",
  message: "Failed to spawn PTY shell $shell in $cwd: $reason",
}) {}

/** PTY session not found */
export class PtyNotFoundError extends errore.createTaggedError({
  name: "PtyNotFoundError",
  message: "PTY session $ptyId not found",
}) {}

/** Failed to get PTY current working directory */
export class PtyCwdError extends errore.createTaggedError({
  name: "PtyCwdError",
  message: "Failed to get CWD for PTY $ptyId: $reason",
}) {}

/** Union of all PTY errors */
export type PtyError = PtySpawnError | PtyNotFoundError | PtyCwdError

/** Session not found */
export class SessionNotFoundError extends errore.createTaggedError({
  name: "SessionNotFoundError",
  message: "Session $sessionId not found",
}) {}

/** Session file is corrupted */
export class SessionCorruptedError extends errore.createTaggedError({
  name: "SessionCorruptedError",
  message: "Session $sessionId is corrupted: $reason",
}) {}

/** Session storage I/O error */
export class SessionStorageError extends errore.createTaggedError({
  name: "SessionStorageError",
  message: "Session storage $operation failed for $path: $reason",
}) {}

/** Union of all session errors */
export type SessionError =
  | SessionNotFoundError
  | SessionCorruptedError
  | SessionStorageError

/** Required services were accessed before initialization */
export class ServicesNotInitializedError extends errore.createTaggedError({
  name: "ServicesNotInitializedError",
  message: "Services not initialized for $operation",
}) {}

/** Aggregate bridge operation failed */
export class AggregateBridgeError extends errore.createTaggedError({
  name: "AggregateBridgeError",
  message: "Aggregate bridge $operation failed for $target: $reason",
}) {}

/** Clipboard operation failed */
export class ClipboardError extends errore.createTaggedError({
  name: "ClipboardError",
  message: "Clipboard $operation failed: $reason",
}) {}

/** Terminal emulator initialization failed */
export class TerminalInitError extends errore.createTaggedError({
  name: "TerminalInitError",
  message: "Terminal initialization failed: $reason",
}) {}

/** Terminal emulator not found */
export class TerminalNotFoundError extends errore.createTaggedError({
  name: "TerminalNotFoundError",
  message: "Terminal emulator for PTY $ptyId not found",
}) {}

/** Template storage error */
export class TemplateStorageError extends errore.createTaggedError({
  name: "TemplateStorageError",
  message: "Template storage $operation failed for $path: $reason",
}) {}

/** Configuration error */
export class ConfigError extends errore.createTaggedError({
  name: "ConfigError",
  message: "Configuration error: $reason",
}) {}

/** Validation error for schema validation */
export class ValidationError extends errore.createTaggedError({
  name: "ValidationError",
  message: "Validation failed: $reason",
}) {}

/** Keyboard routing error */
export class KeyboardRouterError extends errore.createTaggedError({
  name: "KeyboardRouterError",
  message: "Keyboard routing error: $reason",
}) {}

/** File system error */
export class FileSystemError extends errore.createTaggedError({
  name: "FileSystemError",
  message: "File system $operation failed for $path: $reason",
}) {}

/** Shim connection error */
export class ShimConnectionError extends errore.createTaggedError({
  name: "ShimConnectionError",
  message: "Shim connection failed: $reason",
}) {}

/** Kitty graphics offload error */
export class KittyOffloadError extends errore.createTaggedError({
  name: "KittyOffloadError",
  message: "Kitty graphics offload $operation failed: $reason",
}) {}

/** Scrollback archive error */
export class ScrollbackArchiveError extends errore.createTaggedError({
  name: "ScrollbackArchiveError",
  message: "Scrollback archive $operation failed: $reason",
}) {}

/** Terminal color query error */
export class TerminalColorError extends errore.createTaggedError({
  name: "TerminalColorError",
  message: "Terminal color $operation failed: $reason",
}) {}

/** PTY trace error */
export class PtyTraceError extends errore.createTaggedError({
  name: "PtyTraceError",
  message: "PTY trace $operation failed: $reason",
}) {}

/** PTY metadata fetch error (non-fatal, for graceful degradation) */
export class PtyMetadataError extends errore.createTaggedError({
  name: "PtyMetadataError",
  message: "PTY metadata $operation failed for $ptyId: $reason",
}) {}
