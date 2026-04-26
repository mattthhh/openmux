import { compareSemver } from '../../core/update-check';
import { formatVersion, parseReleaseVersion, createDefaultUpdateIO } from './io';
import { getPlatformInfo, fetchTargetRelease } from './release';
import { detectManagedInstall, detectPackageManager, suggestPackageManagerUpdate } from './detect';
import { installRelease, updateManagedWrapper } from './install';
import { computeFileSha256, parseChecksumFile, verifyReleaseChecksum } from './install';
import type { UpdateCommand, CliOutcome, UpdateIO } from './types';

export { getPlatformInfo } from './release';
export { selectLatestRelease } from './release';
export { findReleaseAsset } from './release';
export { detectManagedInstall } from './detect';
export { computeFileSha256, parseChecksumFile, verifyReleaseChecksum } from './install';
export type { UpdateIO } from './types';

const EXIT_SUCCESS = 0;
const EXIT_USAGE = 2;
const EXIT_INTERNAL = 6;

function isAffirmative(answer: string | null): boolean {
  if (!answer) return false;
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

function toCliOutcome(exitCode: number): CliOutcome {
  return { kind: 'handled', exitCode };
}

export async function runUpdateCommand(
  command: UpdateCommand,
  overrides: Partial<UpdateIO> = {}
): Promise<CliOutcome> {
  const ioResult = createDefaultUpdateIO();
  if (ioResult instanceof Error) {
    console.error(`Update init failed: ${ioResult.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }
  const io = { ...ioResult, ...overrides };

  // Check if installed via package manager (npm/bun) first
  const pmInstall = detectPackageManager(io.execPath, io.env);
  if (pmInstall) {
    suggestPackageManagerUpdate(io, pmInstall);
    return toCliOutcome(EXIT_SUCCESS);
  }

  const platformInfo = getPlatformInfo(io.platform, io.arch);
  if (!platformInfo) {
    io.error(`Unsupported platform for updates: ${io.platform}/${io.arch}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const install = await detectManagedInstall(io);
  if (!install.ok) {
    io.error(install.error);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const release = await fetchTargetRelease(io, {
    includePrerelease: command.prerelease,
  });
  if (release instanceof Error) {
    io.error(`Failed to fetch release: ${release.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const latestVersion = parseReleaseVersion(release.tag_name);
  if (!latestVersion) {
    io.error(`Latest release tag is not a valid semver: ${release.tag_name ?? '<missing>'}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  if (compareSemver(install.value.currentVersion, latestVersion) >= 0) {
    io.log(`Already up to date (${formatVersion(install.value.currentVersion)}).`);
    return toCliOutcome(EXIT_SUCCESS);
  }

  if (!command.yes) {
    if (!io.stdinIsTTY) {
      io.error(
        'openmux update requires confirmation in an interactive terminal. Re-run with --yes.'
      );
      return toCliOutcome(EXIT_USAGE);
    }

    const answer = await io.prompt(
      `Update openmux ${formatVersion(install.value.currentVersion)} -> ${formatVersion(latestVersion)}? [y/N] `
    );
    if (!isAffirmative(answer)) {
      io.log('Update cancelled.');
      return toCliOutcome(EXIT_SUCCESS);
    }
  }

  io.log(`Downloading ${formatVersion(latestVersion)} for ${platformInfo.target}...`);
  const installedVersion = await installRelease(
    io,
    release,
    install.value.installDir,
    platformInfo
  );
  if (installedVersion instanceof Error) {
    io.error(`Update failed: ${installedVersion.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  const wrapperResult = await updateManagedWrapper(
    io,
    install.value.wrapperPath,
    install.value.installDir,
    platformInfo,
    installedVersion
  );
  if (wrapperResult instanceof Error) {
    io.error(`Update failed: ${wrapperResult.message}`);
    return toCliOutcome(EXIT_INTERNAL);
  }

  io.log(
    `Updated openmux ${formatVersion(install.value.currentVersion)} -> ${formatVersion(installedVersion)}.`
  );
  return toCliOutcome(EXIT_SUCCESS);
}
