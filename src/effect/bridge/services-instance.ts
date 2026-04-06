/**
 * Global bridge service registry.
 *
 * The long-term direction is explicit dependency passing from composition roots.
 * This module remains as the compatibility boundary for parts of the UI that
 * still resolve services globally.
 */

import type { AppServices } from '../services';
import { disposeServices } from '../services';
import { ServicesNotInitializedError } from '../errors';

let globalServices: AppServices | null = null;

export function setServices(services: AppServices): void {
  globalServices = services;
}

export function getServices(): AppServices | ServicesNotInitializedError {
  if (!globalServices) {
    return new ServicesNotInitializedError({ operation: 'getServices' });
  }
  return globalServices;
}

export function hasServices(): boolean {
  return globalServices !== null;
}

function requireServices(): AppServices {
  const services = getServices();
  if (services instanceof ServicesNotInitializedError) {
    throw services;
  }
  return services;
}

function getService<K extends keyof AppServices>(key: K): AppServices[K] {
  return requireServices()[key];
}

export function getPtyService(): AppServices['pty'] {
  return getService('pty');
}

export function getSessionManager(): AppServices['sessionManager'] {
  return getService('sessionManager');
}

export function getSessionStorage(): AppServices['sessionStorage'] {
  return getService('sessionStorage');
}

export function getTemplateStorage(): AppServices['templateStorage'] {
  return getService('templateStorage');
}

export function getClipboardService(): AppServices['clipboard'] {
  return getService('clipboard');
}

export function getFileSystem(): AppServices['fs'] {
  return getService('fs');
}

export function getKeyboardRouter(): AppServices['keyboardRouter'] {
  return getService('keyboardRouter');
}

export function getConfig(): AppServices['config'] {
  return getService('config');
}

export function disposeServicesSingleton(): void {
  if (!globalServices) {
    return;
  }

  disposeServices(globalServices);
  globalServices = null;
}

export function disposeRuntime(): Promise<void> {
  disposeServicesSingleton();
  return Promise.resolve();
}
