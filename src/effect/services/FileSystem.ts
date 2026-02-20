/**
 * FileSystem service for file I/O operations with schema validation.
 * Migrated from Effect to errore - uses plain promises and Zod schemas.
 */
import type { z } from "zod"
import { tryAsync } from "errore"
import { FileSystemError } from "../errors"

export interface FileSystem {
  /** Read and validate JSON from a file */
  readJson<A>(path: string, schema: z.ZodSchema<A>): Promise<FileSystemError | A>

  /** Encode and write JSON to a file */
  writeJson<A>(path: string, schema: z.ZodSchema<A>, data: A): Promise<FileSystemError | void>

  /** Check if a file exists */
  exists(path: string): Promise<FileSystemError | boolean>

  /** Ensure a directory exists (creates recursively if needed) */
  ensureDir(path: string): Promise<FileSystemError | void>

  /** Delete a file or directory */
  remove(path: string): Promise<FileSystemError | void>

  /** List files in a directory */
  list(path: string): Promise<FileSystemError | string[]>

  /** Read raw text from a file */
  readText(path: string): Promise<FileSystemError | string>

  /** Write raw text to a file */
  writeText(path: string, content: string): Promise<FileSystemError | void>
}

/** Production implementation - uses Bun file APIs */
export const createFileSystem = (): FileSystem => {
  const readJson = async <A>(
    path: string,
    schema: z.ZodSchema<A>
  ): Promise<FileSystemError | A> => {
    const file = Bun.file(path)

    // Check if file exists
    const existsResult = await tryAsync<boolean, FileSystemError>({
      try: () => file.exists(),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    if (existsResult instanceof FileSystemError) return existsResult
    if (!existsResult) {
      return new FileSystemError({
        operation: "read",
        path,
        reason: "File not found",
      })
    }

    // Read file text
    const textResult = await tryAsync<string, FileSystemError>({
      try: () => file.text(),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    if (textResult instanceof FileSystemError) return textResult

    // Parse JSON
    const parseResult = await tryAsync<unknown, FileSystemError>({
      try: async () => JSON.parse(textResult),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    if (parseResult instanceof FileSystemError) return parseResult

    // Validate with schema
    const validationResult = await tryAsync<A, FileSystemError>({
      try: async () => schema.parse(parseResult),
      catch: (e: Error) => new FileSystemError({
        operation: "read",
        path,
        reason: e.message,
      }),
    })

    return validationResult
  }

  const writeJson = async <A>(
    path: string,
    schema: z.ZodSchema<A>,
    data: A
  ): Promise<FileSystemError | void> => {
    // Validate data with schema first
    const validationResult = await tryAsync<A, FileSystemError>({
      try: async () => schema.parse(data),
      catch: (e: Error) => new FileSystemError({
        operation: "write",
        path,
        reason: e.message,
      }),
    })
    if (validationResult instanceof FileSystemError) return validationResult

    // Write to file
    const writeResult = await tryAsync<number, FileSystemError>({
      try: () => Bun.write(path, JSON.stringify(validationResult, null, 2)),
      catch: (e) => new FileSystemError({ operation: "write", path, reason: String(e) }),
    })
    if (writeResult instanceof FileSystemError) return writeResult

    return undefined
  }

  const exists = async (path: string): Promise<FileSystemError | boolean> => {
    const result = await tryAsync<boolean, FileSystemError>({
      try: () => Bun.file(path).exists(),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    return result
  }

  const ensureDir = async (path: string): Promise<FileSystemError | void> => {
    const result = await tryAsync<void, FileSystemError>({
      try: async () => {
        await Bun.$`mkdir -p ${path}`.quiet()
      },
      catch: (e) => new FileSystemError({ operation: "write", path, reason: String(e) }),
    })
    return result
  }

  const remove = async (path: string): Promise<FileSystemError | void> => {
    const result = await tryAsync<void, FileSystemError>({
      try: async () => {
        const file = Bun.file(path)
        const fileExists = await file.exists()
        if (fileExists) {
          await Bun.$`rm -rf ${path}`.quiet()
        }
      },
      catch: (e) => new FileSystemError({ operation: "delete", path, reason: String(e) }),
    })
    return result
  }

  const list = async (path: string): Promise<FileSystemError | string[]> => {
    const result = await tryAsync<string[], FileSystemError>({
      try: async () => {
        const glob = new Bun.Glob("*")
        const files: string[] = []
        for await (const file of glob.scan(path)) {
          files.push(file)
        }
        return files
      },
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    return result
  }

  const readText = async (path: string): Promise<FileSystemError | string> => {
    const file = Bun.file(path)

    // Check if file exists
    const existsResult = await tryAsync<boolean, FileSystemError>({
      try: () => file.exists(),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    if (existsResult instanceof FileSystemError) return existsResult
    if (!existsResult) {
      return new FileSystemError({
        operation: "read",
        path,
        reason: "File not found",
      })
    }

    const result = await tryAsync<string, FileSystemError>({
      try: () => file.text(),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    return result
  }

  const writeText = async (path: string, content: string): Promise<FileSystemError | void> => {
    const result = await tryAsync<number, FileSystemError>({
      try: () => Bun.write(path, content),
      catch: (e) => new FileSystemError({ operation: "write", path, reason: String(e) }),
    })
    if (result instanceof FileSystemError) return result
    return undefined
  }

  return {
    readJson,
    writeJson,
    exists,
    ensureDir,
    remove,
    list,
    readText,
    writeText,
  }
}

/** Production FileSystem instance */
export const FileSystem = createFileSystem()

/** In-memory file system for testing */
export interface InMemoryFileSystem extends FileSystem {
  /** Clear all files and directories */
  clear(): void
  /** Get all stored file paths */
  getFilePaths(): string[]
  /** Get all stored directory paths */
  getDirectoryPaths(): string[]
}

/** Create an in-memory file system for testing */
export const createTestFileSystem = (): InMemoryFileSystem => {
  const files = new Map<string, string>()
  const directories = new Set<string>()

  const readJson = async <A>(
    path: string,
    schema: z.ZodSchema<A>
  ): Promise<FileSystemError | A> => {
    const content = files.get(path)
    if (content === undefined) {
      return new FileSystemError({
        operation: "read",
        path,
        reason: "File not found",
      })
    }

    // Parse JSON
    const parseResult = await tryAsync<unknown, FileSystemError>({
      try: async () => JSON.parse(content),
      catch: (e) => new FileSystemError({ operation: "read", path, reason: String(e) }),
    })
    if (parseResult instanceof FileSystemError) return parseResult

    // Validate with schema
    const validationResult = await tryAsync<A, FileSystemError>({
      try: async () => schema.parse(parseResult),
      catch: (e: Error) => new FileSystemError({
        operation: "read",
        path,
        reason: e.message,
      }),
    })

    return validationResult
  }

  const writeJson = async <A>(
    path: string,
    schema: z.ZodSchema<A>,
    data: A
  ): Promise<FileSystemError | void> => {
    // Validate data with schema first
    const validationResult = await tryAsync<A, FileSystemError>({
      try: async () => schema.parse(data),
      catch: (e: Error) => new FileSystemError({
        operation: "write",
        path,
        reason: e.message,
      }),
    })
    if (validationResult instanceof FileSystemError) return validationResult

    files.set(path, JSON.stringify(validationResult, null, 2))
    return undefined
  }

  const exists = async (path: string): Promise<FileSystemError | boolean> => {
    return files.has(path) || directories.has(path)
  }

  const ensureDir = async (path: string): Promise<FileSystemError | void> => {
    directories.add(path)
    return undefined
  }

  const remove = async (path: string): Promise<FileSystemError | void> => {
    files.delete(path)
    directories.delete(path)
    return undefined
  }

  const list = async (path: string): Promise<FileSystemError | string[]> => {
    const result: string[] = []
    for (const filePath of files.keys()) {
      if (filePath.startsWith(path + "/") || filePath.startsWith(path + "\\")) {
        result.push(filePath.slice(path.length + 1))
      } else if (path === "." && !filePath.includes("/") && !filePath.includes("\\")) {
        result.push(filePath)
      }
    }
    return result
  }

  const readText = async (path: string): Promise<FileSystemError | string> => {
    const content = files.get(path)
    if (content === undefined) {
      return new FileSystemError({
        operation: "read",
        path,
        reason: "File not found",
      })
    }
    return content
  }

  const writeText = async (path: string, content: string): Promise<FileSystemError | void> => {
    files.set(path, content)
    return undefined
  }

  const clear = (): void => {
    files.clear()
    directories.clear()
  }

  const getFilePaths = (): string[] => {
    return Array.from(files.keys())
  }

  const getDirectoryPaths = (): string[] => {
    return Array.from(directories)
  }

  return {
    readJson,
    writeJson,
    exists,
    ensureDir,
    remove,
    list,
    readText,
    writeText,
    clear,
    getFilePaths,
    getDirectoryPaths,
  }
}

/** Test layer factory - creates fresh in-memory file system instances */
export const testLayer = (): InMemoryFileSystem => createTestFileSystem()
