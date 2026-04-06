/**
 * Service composition for openmux.
 * Replaces Effect's Layer composition with simple async initialization.
 */
import { loadAppConfig } from './Config';
import { createFileSystem, createTestFileSystem } from './services/FileSystem';
import { createPtyService, createShimPtyService, createTestPtyService } from './services/Pty';
import { createSessionStorage, createTestSessionStorage } from './services/SessionStorage';
import { createSessionManager, createTestSessionManager } from './services/SessionManager';
import { createClipboard, createTestClipboard } from './services/Clipboard';
import { createTemplateStorage, createTestTemplateStorage } from './services/TemplateStorage';
import { createKeyboardRouter } from './services/KeyboardRouter';
import type { AppConfig } from './Config';
import type { FileSystem, InMemoryFileSystem } from './services/FileSystem';
import type { PtyService } from './services/Pty';
import type { SessionStorage, InMemorySessionStorage } from './services/SessionStorage';
import type { SessionManager } from './services/SessionManager';
import type { Clipboard } from './services/Clipboard';
import type { TemplateStorage, InMemoryTemplateStorage } from './services/TemplateStorage';
import type { KeyboardRouter } from './services/KeyboardRouter';
import { ConfigError } from './errors';
import type { PtySpawnError } from './errors';
import type { SessionStorageError } from './errors';
import type { TemplateStorageError } from './errors';

export interface AppServices {
  config: AppConfig;
  fs: FileSystem;
  pty: PtyService;
  sessionStorage: SessionStorage;
  sessionManager: SessionManager;
  clipboard: Clipboard;
  templateStorage: TemplateStorage;
  keyboardRouter: KeyboardRouter;
}

/**
 * Dispose all services and clean up resources.
 * Call this on application shutdown.
 */
export function disposeServices(services: AppServices): void {
  services.pty.dispose();
}

/**
 * Error type returned by initializeServices
 */
export type ServiceInitError =
  | ConfigError
  | PtySpawnError
  | SessionStorageError
  | TemplateStorageError;

export interface InitializeServicesOptions {
  mode?: 'app' | 'shim';
}

/**
 * Initialize all services for the application.
 * Call this once at startup.
 */
export async function initializeServices(
  options: InitializeServicesOptions = {}
): Promise<ServiceInitError | AppServices> {
  const { mode = 'app' } = options;

  // Load config
  const config = await loadAppConfig();
  if (config instanceof ConfigError) return config;

  // Create file system
  const fs = createFileSystem();

  // Create PTY service for app or shim mode
  const pty = mode === 'app' ? createPtyService(config, fs) : createShimPtyService();

  // Create session storage
  const sessionStorage = await createSessionStorage(fs, config);
  if (sessionStorage instanceof Error) return sessionStorage;

  // Create session manager
  const sessionManager = await createSessionManager(sessionStorage, pty);
  if (sessionManager instanceof Error) return sessionManager;

  // Create clipboard
  const clipboard = await createClipboard();

  // Create template storage
  const templateStorage = await createTemplateStorage(fs, config);
  if (templateStorage instanceof Error) return templateStorage;

  // Create keyboard router
  const keyboardRouter = createKeyboardRouter();

  return {
    config,
    fs,
    pty,
    sessionStorage,
    sessionManager,
    clipboard,
    templateStorage,
    keyboardRouter,
  };
}

/**
 * Test services interface with in-memory implementations
 */
export interface TestAppServices extends AppServices {
  fs: InMemoryFileSystem;
  sessionStorage: InMemorySessionStorage;
  templateStorage: InMemoryTemplateStorage;
}

/**
 * Test service factory - creates isolated services for testing.
 */
export async function createTestServices(): Promise<TestAppServices> {
  // Create test file system
  const fs = createTestFileSystem();

  // Create test PTY service
  const pty = createTestPtyService();

  // Create test session storage
  const sessionStorage = createTestSessionStorage();

  // Create test session manager
  const sessionManager = createTestSessionManager();

  // Create test clipboard
  const clipboard = createTestClipboard();

  // Create test template storage
  const templateStorage = createTestTemplateStorage();

  // Create keyboard router
  const keyboardRouter = createKeyboardRouter();

  // Create test config
  const config: AppConfig = {
    windowGap: 0,
    minPaneWidth: 20,
    minPaneHeight: 5,
    stackRatio: 0.5,
    defaultShell: '/bin/bash',
    sessionStoragePath: '/tmp/openmux-test/sessions',
    templateStoragePath: '/tmp/openmux-test/templates',
  };

  return {
    config,
    fs,
    pty,
    sessionStorage,
    sessionManager,
    clipboard,
    templateStorage,
    keyboardRouter,
  };
}
