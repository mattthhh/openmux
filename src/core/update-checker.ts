import { compareSemver } from './update-check';
import { tryAsync } from 'errore';
import { createTaggedError } from 'errore';

/** Error reading local version */
export class VersionReadError extends createTaggedError({
  name: 'VersionReadError',
  message: 'Failed to read local version: $reason',
}) {}

/** Error fetching latest version */
export class VersionFetchError extends createTaggedError({
  name: 'VersionFetchError',
  message: 'Failed to fetch latest version: $reason',
}) {}

export async function readLocalVersion(): Promise<string | null> {
  const envVersion = process.env.OPENMUX_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, '..', 'package.json');

  const result = await tryAsync<string, VersionReadError>({
    try: async () => readFileSync(pkgPath, 'utf8'),
    catch: (e) => new VersionReadError({ reason: String(e) }),
  });
  if (result instanceof VersionReadError) return null;

  const parseResult = await tryAsync<unknown, VersionReadError>({
    try: async () => JSON.parse(result),
    catch: (e) => new VersionReadError({ reason: String(e) }),
  });
  if (parseResult instanceof VersionReadError) return null;

  const pkg = parseResult as { version?: string };
  return pkg.version ?? null;
}

export async function fetchLatestVersion(signal?: AbortSignal): Promise<string | null> {
  const responseResult = await tryAsync<Response, VersionFetchError>({
    try: async () => fetch('https://registry.npmjs.org/openmux/latest', { signal }),
    catch: (e) => new VersionFetchError({ reason: String(e) }),
  });
  if (responseResult instanceof VersionFetchError) return null;

  if (!responseResult.ok) return null;

  const dataResult = await tryAsync<unknown, VersionFetchError>({
    try: async () => responseResult.json(),
    catch: (e) => new VersionFetchError({ reason: String(e) }),
  });
  if (dataResult instanceof VersionFetchError) return null;

  const data = dataResult as { version?: string };
  return typeof data.version === 'string' ? data.version : null;
}

export async function checkForUpdateLabel(signal?: AbortSignal): Promise<string | null> {
  const currentVersion = await readLocalVersion();
  if (!currentVersion) return null;

  const latestVersion = await fetchLatestVersion(signal);
  if (!latestVersion) return null;

  return compareSemver(currentVersion, latestVersion) < 0 ? '[UPDATE!]' : null;
}
