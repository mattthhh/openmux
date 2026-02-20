/**
 * Domain errors using errore for type-safe, tagged errors.
 * Replaces Effect Schema.TaggedError with plain error classes.
 */
import { createTaggedError } from "errore"

/** Failed to spawn a PTY process */
export class PtySpawnError extends createTaggedError({
  name: "PtySpawnError",
  message: "Failed to spawn PTY shell $shell in $cwd: $reason",
}) {}

/** PTY session not found */
export class PtyNotFoundError extends createTaggedError({
  name: "PtyNotFoundError",
  message: "PTY session $ptyId not found",
}) {}

/** Failed to get PTY current working directory */
export class PtyCwdError extends createTaggedError({
  name: "PtyCwdError",
  message: "Failed to get CWD for PTY $ptyId: $reason",
}) {}

/** Union of all PTY errors */
export type PtyError = PtySpawnError | PtyNotFoundError | PtyCwdError

/** Session not found */
export class SessionNotFoundError extends createTaggedError({
  name: "SessionNotFoundError",
  message: "Session $sessionId not found",
}) {}

/** Session file is corrupted */
export class SessionCorruptedError extends createTaggedError({
  name: "SessionCorruptedError",
  message: "Session $sessionId is corrupted: $reason",
}) {}

/** Session storage I/O error */
export class SessionStorageError extends createTaggedError({
  name: "SessionStorageError",
  message: "Session storage $operation failed for $path: $reason",
}) {}

/** Union of all session errors */
export type SessionError =
  | SessionNotFoundError
  | SessionCorruptedError
  | SessionStorageError

/** Clipboard operation failed */
export class ClipboardError extends createTaggedError({
  name: "ClipboardError",
  message: "Clipboard $operation failed: $reason",
}) {}

/** Terminal emulator initialization failed */
export class TerminalInitError extends createTaggedError({
  name: "TerminalInitError",
  message: "Terminal initialization failed: $reason",
}) {}

/** Terminal emulator not found */
export class TerminalNotFoundError extends createTaggedError({
  name: "TerminalNotFoundError",
  message: "Terminal emulator for PTY $ptyId not found",
}) {}

/** Template storage error */
export class TemplateStorageError extends createTaggedError({
  name: "TemplateStorageError",
  message: "Template storage $operation failed for $path: $reason",
}) {}

/** Configuration error */
export class ConfigError extends createTaggedError({
  name: "ConfigError",
  message: "Configuration error: $reason",
}) {}

/** Validation error for schema validation */
export class ValidationError extends createTaggedError({
  name: "ValidationError",
  message: "Validation failed: $reason",
}) {}

/** Keyboard routing error */
export class KeyboardRouterError extends createTaggedError({
  name: "KeyboardRouterError",
  message: "Keyboard routing error: $reason",
}) {}

/** File system error */
export class FileSystemError extends createTaggedError({
  name: "FileSystemError",
  message: "File system $operation failed for $path: $reason",
}) {}

/** Shim connection error */
export class ShimConnectionError extends createTaggedError({
  name: "ShimConnectionError",
  message: "Shim connection failed: $reason",
}) {}

/** Kitty graphics offload error */
export class KittyOffloadError extends createTaggedError({
  name: "KittyOffloadError",
  message: "Kitty graphics offload $operation failed: $reason",
}) {}

/** Scrollback archive error */
export class ScrollbackArchiveError extends createTaggedError({
  name: "ScrollbackArchiveError",
  message: "Scrollback archive $operation failed: $reason",
}) {}

/** Terminal color query error */
export class TerminalColorError extends createTaggedError({
  name: "TerminalColorError",
  message: "Terminal color $operation failed: $reason",
}) {}

/** PTY trace error */
export class PtyTraceError extends createTaggedError({
  name: "PtyTraceError",
  message: "PTY trace $operation failed: $reason",
}) {}
