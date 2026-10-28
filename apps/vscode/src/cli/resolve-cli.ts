import path from 'node:path';

/** How to launch `@contentia/cli`: a program plus the leading args before the subcommand. */
export interface CliInvocation {
  readonly command: string;
  readonly args: readonly string[];
  /** Where it came from, shown in the output channel so "which CLI ran?" is never a guess. */
  readonly source: 'setting' | 'env' | 'workspace' | 'npx';
  /** `.cmd` shims on Windows only run through a shell. */
  readonly shell: boolean;
}

export interface ResolveCliInput {
  /** The `contentia.cli.path` setting; empty means unset. */
  readonly settingPath: string;
  /** `CONTENTIA_CLI_PATH`, set by the extension's launch config during development. */
  readonly envPath: string | undefined;
  readonly workspaceFolders: readonly string[];
  readonly platform: NodeJS.Platform;
  readonly exists: (file: string) => boolean;
}

const fromPath = (file: string, source: CliInvocation['source'], platform: NodeJS.Platform): CliInvocation =>
  /\.[cm]?js$/.test(file)
    ? { command: 'node', args: [file], source, shell: false }
    : { command: file, args: [], source, shell: platform === 'win32' };

/**
 * Pick the `@contentia/cli` to run, in order: the `contentia.cli.path` setting, the
 * `CONTENTIA_CLI_PATH` env var, the first workspace folder that has
 * `node_modules/.bin/contentia`, then `npx contentia`. Preferring the workspace's
 * own install keeps the extension on the project's CLI version and backends,
 * the same way the git extension runs whatever `git` the user has.
 */
export const resolveCli = (input: ResolveCliInput): CliInvocation => {
  if (input.settingPath) return fromPath(input.settingPath, 'setting', input.platform);
  if (input.envPath) return fromPath(input.envPath, 'env', input.platform);
  const bin = input.platform === 'win32' ? 'contentia.cmd' : 'contentia';
  for (const folder of input.workspaceFolders) {
    const candidate = path.join(folder, 'node_modules', '.bin', bin);
    if (input.exists(candidate)) return fromPath(candidate, 'workspace', input.platform);
  }
  return {
    command: input.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['--yes', 'contentia'],
    source: 'npx',
    shell: input.platform === 'win32',
  };
};
