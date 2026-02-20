/**
 * TemplateStorage service for layout template persistence.
 * Migrated from Effect to errore - uses plain promises and Zod schemas.
 */
import type { FileSystem } from "./FileSystem"
import type { AppConfig } from "../Config"
import { TemplateStorageError, FileSystemError } from "../errors"
import { TemplateSessionSchema, type TemplateSession } from "../models"

export interface TemplateStorage {
  /** Load a template by ID */
  loadTemplate(id: string): Promise<TemplateStorageError | TemplateSession | null>
  /** Save a template */
  saveTemplate(template: TemplateSession): Promise<TemplateStorageError | void>
  /** Delete a template */
  deleteTemplate(id: string): Promise<TemplateStorageError | void>
  /** List all template metadata */
  listTemplates(): Promise<TemplateStorageError | TemplateMetadata[]>
}

/** Template metadata for listing (extracted from TemplateSession) */
export interface TemplateMetadata {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

/**
 * Create a production TemplateStorage instance.
 * Takes FileSystem and AppConfig as direct dependencies.
 */
export async function createTemplateStorage(
  fs: FileSystem,
  config: AppConfig
): Promise<TemplateStorageError | TemplateStorage> {
  const storagePath = config.templateStoragePath
  const templatePath = (id: string) => `${storagePath}/${id}.json`

  // Ensure storage directory exists on initialization
  const ensureDirResult = await fs.ensureDir(storagePath)
  if (ensureDirResult instanceof FileSystemError) {
    return new TemplateStorageError({
      operation: "initialize",
      path: storagePath,
      reason: ensureDirResult.reason,
    })
  }

  const loadTemplate = async (
    id: string
  ): Promise<TemplateStorageError | TemplateSession | null> => {
    const path = templatePath(id)
    const exists = await fs.exists(path)

    if (!exists) {
      return null
    }

    const result = await fs.readJson(path, TemplateSessionSchema)

    if (result instanceof FileSystemError) {
      return new TemplateStorageError({
        operation: "loadTemplate",
        path,
        reason: result.reason,
      })
    }

    return result
  }

  const saveTemplate = async (
    template: TemplateSession
  ): Promise<TemplateStorageError | void> => {
    const result = await fs.writeJson(templatePath(template.id), TemplateSessionSchema, template)

    if (result instanceof FileSystemError) {
      return new TemplateStorageError({
        operation: "saveTemplate",
        path: templatePath(template.id),
        reason: result.reason,
      })
    }

    return undefined
  }

  const deleteTemplate = async (id: string): Promise<TemplateStorageError | void> => {
    const result = await fs.remove(templatePath(id))

    if (result instanceof FileSystemError) {
      return new TemplateStorageError({
        operation: "deleteTemplate",
        path: templatePath(id),
        reason: result.reason,
      })
    }

    return undefined
  }

  const listTemplates = async (): Promise<TemplateStorageError | TemplateMetadata[]> => {
    const listResult = await fs.list(storagePath)

    if (listResult instanceof FileSystemError) {
      return new TemplateStorageError({
        operation: "listTemplates",
        path: storagePath,
        reason: listResult.reason,
      })
    }

    const templates: TemplateMetadata[] = []

    for (const file of listResult) {
      if (!file.endsWith(".json")) continue

      const id = file.slice(0, -5) // Remove .json extension
      const templateResult = await loadTemplate(id)

      if (templateResult instanceof TemplateStorageError) continue
      if (templateResult === null) continue

      templates.push({
        id: templateResult.id,
        name: templateResult.name,
        createdAt: templateResult.createdAt,
        updatedAt: templateResult.updatedAt,
      })
    }

    // Sort by name
    templates.sort((a, b) => a.name.localeCompare(b.name))

    return templates
  }

  return {
    loadTemplate,
    saveTemplate,
    deleteTemplate,
    listTemplates,
  }
}

/**
 * In-memory template storage for testing.
 * Implements the same interface but stores data in memory.
 */
export interface InMemoryTemplateStorage extends TemplateStorage {
  /** Clear all stored templates */
  clear(): void
  /** Get all stored template IDs */
  getTemplateIds(): string[]
}

/**
 * Create an in-memory TemplateStorage for testing.
 */
export function createTestTemplateStorage(): InMemoryTemplateStorage {
  const templates = new Map<string, TemplateSession>()

  const loadTemplate = async (
    id: string
  ): Promise<TemplateStorageError | TemplateSession | null> => {
    const template = templates.get(id)
    return template ?? null
  }

  const saveTemplate = async (
    template: TemplateSession
  ): Promise<TemplateStorageError | void> => {
    templates.set(template.id, template)
    return undefined
  }

  const deleteTemplate = async (id: string): Promise<TemplateStorageError | void> => {
    templates.delete(id)
    return undefined
  }

    const listTemplates = async (): Promise<TemplateStorageError | TemplateMetadata[]> => {
      const metadata: TemplateMetadata[] = []

      for (const template of Array.from(templates.values())) {
      metadata.push({
        id: template.id,
        name: template.name,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      })
    }

    // Sort by name
    metadata.sort((a, b) => a.name.localeCompare(b.name))

    return metadata
  }

  const clear = (): void => {
    templates.clear()
  }

  const getTemplateIds = (): string[] => {
    return Array.from(templates.keys())
  }

  return {
    loadTemplate,
    saveTemplate,
    deleteTemplate,
    listTemplates,
    clear,
    getTemplateIds,
  }
}
