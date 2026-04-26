import type { UpdateError } from '../../effect/errors';

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type ReadFileFn = (filePath: string) => Promise<string | UpdateError>;
export type WriteFileFn = (
  filePath: string,
  data: string | Uint8Array
) => Promise<void | UpdateError>;
export type CopyFileFn = (source: string, destination: string) => Promise<void | UpdateError>;
export type ChmodFn = (targetPath: string, mode: number) => Promise<void | UpdateError>;
export type RenameFn = (source: string, destination: string) => Promise<void | UpdateError>;
export type MkdirFn = (dirPath: string) => Promise<void | UpdateError>;
export type MkdtempFn = (prefix: string) => Promise<string | UpdateError>;
export type RmFn = (targetPath: string) => Promise<void | UpdateError>;
export type AccessFn = (targetPath: string) => Promise<void | UpdateError>;
export type PromptFn = (message: string) => Promise<string | null>;
export type TarExtractFn = (archivePath: string, destination: string) => Promise<void>;

export type UpdateIO = {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  execPath: string;
  stdinIsTTY: boolean;
  fetch: FetchFn;
  readFile: ReadFileFn;
  writeFile: WriteFileFn;
  copyFile: CopyFileFn;
  chmod: ChmodFn;
  rename: RenameFn;
  mkdir: MkdirFn;
  mkdtemp: MkdtempFn;
  rm: RmFn;
  access: AccessFn;
  tmpdir: () => string;
  prompt: PromptFn;
  extractTarGz: TarExtractFn;
  log: (message: string) => void;
  error: (message: string) => void;
};

export type GitHubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  digest?: string;
};

export type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubReleaseAsset[];
};

export type PlatformInfo = {
  target: string;
  libExt: 'dylib' | 'so';
};

export type PackageManager = 'npm' | 'bun' | null;

export type PackageManagerInstall = {
  type: PackageManager;
  updateCommand: string;
};

export type ManagedInstall = {
  binDir: string;
  wrapperPath: string;
  installDir: string;
  currentVersion: string;
};

export type UpdateCommand = {
  kind: 'update';
  yes: boolean;
  prerelease: boolean;
};

export type CliOutcome = { kind: 'handled'; exitCode: number };
