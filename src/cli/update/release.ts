import { UpdateError } from '../../effect/errors';
import { compareSemver } from '../../core/update-check';
import type { UpdateIO, GitHubRelease, PlatformInfo } from './types';
import { parseReleaseVersion } from './io';

const REPO = 'monotykamary/openmux';
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO}`;

export function getPlatformInfo(platform: NodeJS.Platform, arch: string): PlatformInfo | null {
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return { target: 'darwin-arm64', libExt: 'dylib' };
    }
    if (arch === 'x64') {
      return { target: 'darwin-x64', libExt: 'dylib' };
    }
    return null;
  }
  if (platform === 'linux') {
    if (arch === 'x64') {
      return { target: 'linux-x64', libExt: 'so' };
    }
    if (arch === 'arm64') {
      return { target: 'linux-arm64', libExt: 'so' };
    }
    return null;
  }
  return null;
}

export function selectLatestRelease(
  releases: GitHubRelease[],
  options: { includePrerelease: boolean }
): GitHubRelease | null {
  const { includePrerelease } = options;
  const candidates = releases.filter((release) => {
    if (release.draft) return false;
    if (!includePrerelease && release.prerelease) return false;
    return parseReleaseVersion(release.tag_name) !== null;
  });

  let best: GitHubRelease | null = null;
  let bestVersion: string | null = null;

  for (const release of candidates) {
    const version = parseReleaseVersion(release.tag_name);
    if (!version) continue;
    if (!bestVersion || compareSemver(bestVersion, version) < 0) {
      best = release;
      bestVersion = version;
    }
  }

  return best;
}

export function findReleaseAsset(
  release: GitHubRelease,
  target: string
): { name: string; url: string } | null {
  const assets = release.assets ?? [];
  const exactName = `openmux-${release.tag_name}-${target}.tar.gz`;

  const exact = assets.find((asset) => asset.name === exactName && asset.browser_download_url);
  if (exact?.name && exact.browser_download_url) {
    return { name: exact.name, url: exact.browser_download_url };
  }

  const fallback = assets.find(
    (asset) => asset.name?.endsWith(`-${target}.tar.gz`) && asset.browser_download_url
  );
  if (!fallback?.name || !fallback.browser_download_url) return null;
  return { name: fallback.name, url: fallback.browser_download_url };
}

async function fetchGitHubJson<T>(io: UpdateIO, url: string): Promise<T | UpdateError> {
  const response = await io
    .fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'openmux-update',
      },
    })
    .catch((e) => new UpdateError({ operation: 'fetch', reason: String(e), cause: e }));
  if (response instanceof UpdateError) return response;

  if (!response.ok) {
    return new UpdateError({
      operation: 'fetch',
      reason: `GitHub API request failed (${response.status})`,
    });
  }

  const data = await (response.json() as Promise<T>).catch(
    (e) =>
      new UpdateError({
        operation: 'fetch',
        reason: `Invalid JSON response: ${String(e)}`,
        cause: e,
      })
  );
  return data;
}

export async function fetchTargetRelease(
  io: UpdateIO,
  options: { includePrerelease: boolean }
): Promise<GitHubRelease | UpdateError> {
  const { includePrerelease } = options;
  if (!includePrerelease) {
    const release = await fetchGitHubJson<GitHubRelease>(io, `${GITHUB_API_BASE}/releases/latest`);
    if (release instanceof UpdateError) return release;
    if (!release || !release.tag_name) {
      return new UpdateError({
        operation: 'fetchRelease',
        reason: 'GitHub latest release response is missing tag information',
      });
    }
    return release;
  }

  const releases = await fetchGitHubJson<GitHubRelease[]>(
    io,
    `${GITHUB_API_BASE}/releases?per_page=30`
  );
  if (releases instanceof UpdateError) return releases;
  const selected = selectLatestRelease(releases, { includePrerelease: true });
  if (!selected) {
    return new UpdateError({
      operation: 'fetchRelease',
      reason: 'No valid GitHub releases were found',
    });
  }
  return selected;
}
