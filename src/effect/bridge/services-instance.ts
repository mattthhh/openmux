/**
 * Services singleton for bridge functions
 * 
 * This provides global access to service instances initialized by the application.
 * Bridge functions use this singleton internally to maintain backward compatibility
 * with the old API (where services were not passed as arguments).
 */
import type { AppServices } from "../services"

// Global singleton storage
let globalServices: AppServices | null = null

/**
 * Set the global services instance.
 * Call this once after initializing services.
 */
export function setServices(services: AppServices): void {
  globalServices = services
}

/**
 * Get the global services instance.
 * Throws if services haven't been initialized.
 */
export function getServices(): AppServices {
  if (!globalServices) {
    throw new Error("Services not initialized. Call setServices() first.")
  }
  return globalServices
}

/**
 * Check if services have been initialized.
 */
export function hasServices(): boolean {
  return globalServices !== null
}

/**
 * Get the PTY service instance.
 */
export function getPtyService(): AppServices["pty"] {
  return getServices().pty
}

/**
 * Get the SessionManager service instance.
 */
export function getSessionManager(): AppServices["sessionManager"] {
  return getServices().sessionManager
}

/**
 * Get the SessionStorage service instance.
 */
export function getSessionStorage(): AppServices["sessionStorage"] {
  return getServices().sessionStorage
}

/**
 * Get the TemplateStorage service instance.
 */
export function getTemplateStorage(): AppServices["templateStorage"] {
  return getServices().templateStorage
}

/**
 * Get the Clipboard service instance.
 */
export function getClipboardService(): AppServices["clipboard"] {
  return getServices().clipboard
}

/**
 * Get the FileSystem service instance.
 */
export function getFileSystem(): AppServices["fs"] {
  return getServices().fs
}

/**
 * Get the KeyboardRouter service instance.
 */
export function getKeyboardRouter(): AppServices["keyboardRouter"] {
  return getServices().keyboardRouter
}

/**
 * Get the AppConfig.
 */
export function getConfig(): AppServices["config"] {
  return getServices().config
}
