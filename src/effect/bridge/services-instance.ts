/**
 * Services singleton for bridge functions
 *
 * This provides global access to service instances initialized by the application.
 * Bridge functions use this singleton internally to maintain backward compatibility
 * with the old API (where services were not passed as arguments).
 */
import type { AppServices } from '../services';
import { disposeServices } from '../services';

import { ServicesNotInitializedError } from '../errors';

// ... existing imports ...
let globalServices: AppServices | null = null;

/**
 * Set the global services instance.
 * Call this once after initializing services.
 */
export function setServices(services: AppServices): void {
  globalServices = services;
}

/**
 * Get the global services instance.
 * Returns error if services haven't been initialized.
 */
export function getServices(): AppServices | ServicesNotInitializedError {
  if (!globalServices) {
    return new ServicesNotInitializedError({ operation: 'getServices' });
  }
  return globalServices;
}

/**
 * Check if services have been initialized.
 */
export function hasServices(): boolean {
  return globalServices !== null;
}

/**
 * Get the PTY service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getPtyService(): AppServices['pty'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.pty;
}

/**
 * Get the SessionManager service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getSessionManager(): AppServices['sessionManager'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.sessionManager;
}

/**
 * Get the SessionStorage service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getSessionStorage(): AppServices['sessionStorage'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.sessionStorage;
}

/**
 * Get the TemplateStorage service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getTemplateStorage(): AppServices['templateStorage'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.templateStorage;
}

/**
 * Get the Clipboard service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getClipboardService(): AppServices['clipboard'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.clipboard;
}

/**
 * Get the FileSystem service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getFileSystem(): AppServices['fs'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.fs;
}

/**
 * Get the KeyboardRouter service instance.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getKeyboardRouter(): AppServices['keyboardRouter'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.keyboardRouter;
}

/**
 * Get the AppConfig.
 * Throws if services haven't been initialized - this is a programming error.
 */
export function getConfig(): AppServices['config'] {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services.config;
}

/**
 * Dispose all services and clean up resources.
 * Call this on application shutdown.
 */
export function disposeServicesSingleton(): void {
  if (globalServices) {
    disposeServices(globalServices);
    globalServices = null;
  }
}
