import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  type ContentiaBackendModuleConfig,
  DEFAULT_LOCAL_BACKEND_BASE_PATH,
  DEFAULT_LOCAL_BACKEND_DEV_TOKEN,
  resolveContentiaBackend,
} from './resolve-contentia-backend.js';

const remote: ContentiaBackendModuleConfig = {
  name: 'contentia',
  base_url: 'https://api.example.com',
  app_id: 'remote-app-id',
};

describe('resolveContentiaBackend()', () => {
  it('dev flag truthy: returns a local backend targeting the Vite plugin default base path with a dummy token', () => {
    const backend = resolveContentiaBackend({ remote, dev: true });

    expect(backend).toMatchObject({
      name: 'contentia',
      base_url: DEFAULT_LOCAL_BACKEND_BASE_PATH,
      dev_token: DEFAULT_LOCAL_BACKEND_DEV_TOKEN,
    });
    // Never the remote config's identity when local mode is selected.
    expect(backend).not.toMatchObject({ app_id: remote.app_id });
  });

  it('dev flag truthy + local overrides: honours a custom basePath and devToken', () => {
    const backend = resolveContentiaBackend({
      local: { basePath: '/api/local', devToken: 'my-dummy-token' },
      remote,
      dev: true,
    });

    expect(backend).toMatchObject({
      name: 'contentia',
      base_url: '/api/local',
      dev_token: 'my-dummy-token',
    });
  });

  it('dev flag falsy: returns the remote backend unchanged (fail-safe, never the local one)', () => {
    const backend = resolveContentiaBackend({ remote, dev: false });

    expect(backend).toBe(remote);
  });

  it('real import.meta.env.DEV default is only consulted when `dev` is omitted entirely', () => {
    // Sanity check for the default-parameter wiring itself: omitting `dev`
    // reads the live `import.meta.env.DEV` rather than defaulting to `false`
    // outright. Vitest's own Vite pipeline sets `DEV: true`, so local mode
    // engages here. This is the behaviour real `vite dev` relies on; a
    // production build (`DEV: false`) falls through to `remote` the same way
    // the explicit-`false` cases above do.
    const backend = resolveContentiaBackend({ remote });

    expect(backend).toMatchObject({ name: 'contentia', base_url: DEFAULT_LOCAL_BACKEND_BASE_PATH });
  });
});

describe('README documents resolveContentiaBackend()', () => {
  // Pinning test: resolveContentiaBackend() and its public exports must stay
  // covered by the package README. Vitest runs from the package root, so
  // resolve the README off `process.cwd()`.
  const readme = readFileSync(`${process.cwd()}/README.md`, 'utf-8');

  it.each([
    'resolveContentiaBackend',
    'LocalContentiaBackendOptions',
    'ResolveContentiaBackendOptions',
    'DEFAULT_LOCAL_BACKEND_BASE_PATH',
    'DEFAULT_LOCAL_BACKEND_DEV_TOKEN',
  ])('mentions %s', name => {
    expect(readme).toContain(name);
  });

  it('documents the local defaults', () => {
    expect(readme).toContain(DEFAULT_LOCAL_BACKEND_BASE_PATH);
    expect(readme).toContain(DEFAULT_LOCAL_BACKEND_DEV_TOKEN);
  });
});
