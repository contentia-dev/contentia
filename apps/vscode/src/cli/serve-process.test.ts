import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StorageJsonApiProxyRepository } from 'contentia/storage/jsonapi-proxy';

import { listStorageFolder } from '../explorer/listing.js';
import type { CliInvocation } from './resolve-cli.js';
import { type RunningServer, startServe } from './serve-process.js';

// The contract between the extension and contentia: the real, locally built CLI
// started the way the extension starts it, browsed the way the trees browse it.
// A change to `serve --json` output that the extension can't read fails here.
const cliEntry = fileURLToPath(new URL('../../../cli/dist/cli.js', import.meta.url));
const cli: CliInvocation = { command: 'node', args: [cliEntry], source: 'env', shell: false };

describe('startServe against the local contentia build', () => {
  let root: string;
  let server: RunningServer | undefined;
  const logs: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'contentia-vscode-'));
    await mkdir(path.join(root, 'posts'));
    await writeFile(path.join(root, 'posts', 'hello.md'), '---\ntitle: Hello\n---\n# Hello\n');
    await writeFile(path.join(root, 'settings.json'), '{"title":"Site"}');
  });

  afterEach(async () => {
    server?.stop();
    server = undefined;
    await rm(root, { recursive: true, force: true });
  });

  const start = () =>
    startServe({ cli, backend: 'fs', backendOptions: { root }, cwd: root, log: line => logs.push(line) });

  it('reports a bound URL and serves the backend behind a per-process token', async () => {
    server = await start();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${server.url}/atoms`)).status).toBe(401);

    const repo = new StorageJsonApiProxyRepository({ baseUrl: server.url, authToken: server.authToken });
    const rootPage = await listStorageFolder(repo, '', 1);
    expect(rootPage.entries.map(e => [e.kind, e.key])).toEqual([['folder', 'posts'], ['object', 'settings']]);
    const posts = await listStorageFolder(repo, 'posts', 1);
    expect(posts.entries.map(e => [e.kind, e.key, e.label])).toEqual([['object', 'posts/hello', 'hello']]);
  });

  it('rejects with the CLI error message when the backend is unknown', async () => {
    await expect(
      startServe({ cli, backend: 'nope', backendOptions: {}, cwd: root, log: () => {} }),
    ).rejects.toThrow('unknown storage backend "nope"');
  });

  it('notifies exit listeners when the server stops', async () => {
    server = await start();
    const exited = new Promise(resolve => server!.onExit(resolve));
    server.stop();
    await expect(exited).resolves.not.toBe(undefined);
  });
});
