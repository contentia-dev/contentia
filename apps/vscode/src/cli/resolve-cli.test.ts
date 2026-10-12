import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveCli, type ResolveCliInput } from './resolve-cli.js';

const input = (overrides: Partial<ResolveCliInput>): ResolveCliInput => ({
  settingPath: '',
  envPath: undefined,
  workspaceFolders: [],
  platform: 'darwin',
  exists: () => false,
  ...overrides,
});

describe('resolveCli', () => {
  it('prefers the setting over the env var and the workspace install', () => {
    const cli = resolveCli(input({
      settingPath: '/opt/laika',
      envPath: '/dev/cli.js',
      workspaceFolders: ['/ws'],
      exists: () => true,
    }));
    expect(cli).toMatchObject({ command: '/opt/laika', args: [], source: 'setting' });
  });

  it('runs a .js entry point (the local apps/cli build) with node', () => {
    expect(resolveCli(input({ envPath: '/repo/apps/cli/dist/cli.js' })))
      .toMatchObject({ command: 'node', args: ['/repo/apps/cli/dist/cli.js'], source: 'env' });
  });

  it("uses the first workspace folder that has the project's own laikacli", () => {
    const own = path.join('/b', 'node_modules', '.bin', 'laika');
    const cli = resolveCli(input({ workspaceFolders: ['/a', '/b'], exists: file => file === own }));
    expect(cli).toMatchObject({ command: own, source: 'workspace', shell: false });
  });

  it('looks for the .cmd shim on Windows and runs it through a shell', () => {
    const own = path.join('C:\\ws', 'node_modules', '.bin', 'laika.cmd');
    const cli = resolveCli(input({ platform: 'win32', workspaceFolders: ['C:\\ws'], exists: file => file === own }));
    expect(cli).toMatchObject({ command: own, shell: true });
  });

  it('falls back to npx laikacli', () => {
    expect(resolveCli(input({}))).toMatchObject({ command: 'npx', args: ['--yes', 'laikacli'], source: 'npx' });
  });
});
