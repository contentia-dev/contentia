import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadServerConfig, parseServerConfig } from './config.js';

const HASH = 'a'.repeat(64);
const BCRYPT = `$2a$12$${'N9qo8uLOickgx2ZMRZoMye'.padEnd(53, 'x')}`;
const minimal = {
  storage: { backend: 'fs', options: { root: '/content' } },
  auth: { apiKeys: [{ name: 'build', sha256: HASH, scopes: ['content:read'] }] },
};
const withAuth = (auth: unknown) => ({ ...minimal, auth });
const oidc = (extra: Record<string, unknown> = {}) =>
  withAuth({ oidc: { issuer: 'https://login.example.com', audience: 'contentia', ...extra } });

describe('parseServerConfig', () => {
  it('fills in defaults', () => {
    expect(parseServerConfig(minimal)).toEqual({
      listen: { host: '127.0.0.1', port: 8080 },
      basePath: '/api',
      storage: { backend: 'fs', options: { root: '/content' } },
      catalog: { provider: 'convention' },
      assets: true,
      auth: { apiKeys: [{ name: 'build', sha256: HASH, scopes: ['content:read'] }] },
    });
  });

  it('reads a full config', () => {
    const config = parseServerConfig({
      listen: { host: '0.0.0.0', port: '3000' },
      basePath: '/cms',
      cors: { origins: ['https://admin.example.com'], maxAge: 600 },
      storage: { backend: 'github', options: { owner: 'acme', repo: 'site', branch: 'main' } },
      catalog: { provider: 'decap', configKey: 'admin/config' },
      assets: 'false',
      auth: {
        oidc: {
          issuer: 'https://login.example.com/realms/acme',
          audience: ['contentia', 'cms'],
          algorithms: ['RS256', 'ES256'],
          clockToleranceSeconds: 30,
          rolesClaim: 'realm_access.roles',
          roles: { editor: ['content:read', 'content:write'], admin: ['admin'] },
          scopesClaim: 'scope',
          defaultScopes: ['content:read'],
        },
        apiKeys: [{ name: 'build', sha256: HASH.toUpperCase(), scopes: ['content:read', 'media:read'] }],
      },
    });
    expect(config.listen).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(config.cors).toEqual({ origins: ['https://admin.example.com'], maxAge: 600 });
    expect(config.catalog).toEqual({ provider: 'decap', configKey: 'admin/config' });
    expect(config.assets).toBe(false);
    expect(config.auth.oidc).toEqual({
      issuer: 'https://login.example.com/realms/acme',
      audience: ['contentia', 'cms'],
      algorithms: ['RS256', 'ES256'],
      clockToleranceSeconds: 30,
      rolesClaim: 'realm_access.roles',
      roles: { editor: ['content:read', 'content:write'], admin: ['admin'] },
      scopesClaim: 'scope',
      defaultScopes: ['content:read'],
    });
    expect(config.auth.apiKeys[0]!.sha256).toBe(HASH);
  });

  it('accepts the catalog shorthand and defaults the decap config key', () => {
    expect(parseServerConfig({ ...minimal, catalog: 'decap' }).catalog).toEqual({
      provider: 'decap',
      configKey: 'config',
    });
  });

  it('reads trusted proxies as a list or one comma-separated string (as ${env:…} gives)', () => {
    const listen = (trustedProxies: unknown) => parseServerConfig({ ...minimal, listen: { trustedProxies } }).listen;
    expect(listen(['10.0.0.0/8', 'fd00::/8']).trustedProxies).toEqual(['10.0.0.0/8', 'fd00::/8']);
    expect(listen('10.0.0.0/8, 192.168.1.7').trustedProxies).toEqual(['10.0.0.0/8', '192.168.1.7']);
  });

  it('accepts OIDC alone', () => {
    expect(parseServerConfig(oidc()).auth).toEqual({
      apiKeys: [],
      oidc: { issuer: 'https://login.example.com', audience: ['contentia'], roles: {}, defaultScopes: [] },
    });
  });

  it.each([
    [{ auth: minimal.auth }, /^storage: required/],
    [{ storage: minimal.storage }, /^auth: required/],
    [withAuth({}), /^auth: configure auth.oidc .* and\/or auth.apiKeys/],
    [{ ...minimal, auht: {} }, /^auht: unknown setting/],
    [withAuth({ ...minimal.auth, odic: {} }), /^auth.odic: unknown setting/],
    [{ ...minimal, storage: { backend: 'fs', option: {} } }, /^storage.option: unknown setting/],
    [{ ...minimal, listen: { port: 70000 } }, /^listen.port: must be an integer/],
    [{ ...minimal, listen: { trustedProxies: [] } }, /^listen.trustedProxies: must be a non-empty/],
    [
      { ...minimal, listen: { trustedProxies: ['10.0.0.0/8', 'ingress.local'] } },
      /^listen.trustedProxies: "ingress.local" is not an IP address or CIDR range/,
    ],
    [{ ...minimal, basePath: 'api' }, /^basePath: must start with "\/"/],
    [{ ...minimal, catalog: 'notion' }, /^catalog.provider: must be "convention" or "decap"/],
    [{ ...minimal, catalog: { provider: 'convention', configKey: 'x' } }, /only applies to the decap provider/],
    [{ ...minimal, cors: { origins: [] } }, /^cors.origins: must be a non-empty/],
    [{ ...minimal, assets: 'yes' }, /^assets: must be true or false/],
  ])('rejects %j', (raw, message) => {
    expect(() => parseServerConfig(raw)).toThrow(message);
  });

  describe('auth.apiKeys', () => {
    const key = (entry: Record<string, unknown>) =>
      withAuth({ apiKeys: [{ name: 'k', sha256: HASH, scopes: ['admin'], ...entry }] });

    it.each([
      [key({ sha256: 'my-secret-key' }), /not the key itself/],
      [key({ scopes: [] }), /needs at least one scope/],
      [key({ scopes: ['write'] }), /"write" is not a scope/],
      [key({ scopes: 'admin' }), /must be a list of scopes/],
      [key({ key: 'plaintext' }), /apiKeys\[0\].key: unknown setting/],
      [
        withAuth({
          apiKeys: [{ name: 'k', sha256: HASH, scopes: ['admin'] }, { name: 'k', sha256: HASH, scopes: ['admin'] }],
        }),
        /duplicate API key name "k"/,
      ],
      [withAuth({ apiKeys: { name: 'k' } }), /auth.apiKeys: must be a list/],
    ])('rejects %j', (raw, message) => {
      expect(() => parseServerConfig(raw)).toThrow(message);
    });
  });

  describe('auth.oidc', () => {
    it.each([
      [oidc({ issuer: 'http://login.example.com' }), /issuer: must be an https URL/],
      [oidc({ jwksUri: 'http://login.example.com/certs' }), /jwksUri: must be an https URL/],
      [oidc({ audience: undefined }), /audience: must be a non-empty/],
      [oidc({ algorithms: ['HS256'] }), /"HS256" is not a supported algorithm/],
      [oidc({ algorithms: ['none'] }), /"none" is not a supported algorithm/],
      [oidc({ roles: { editor: ['content:write'] } }), /set rolesClaim/],
      [oidc({ rolesClaim: 'roles', roles: { editor: ['editor'] } }), /roles.editor: "editor" is not a scope/],
      [oidc({ clockToleranceSeconds: 3600 }), /clockToleranceSeconds: must be an integer between 0 and 600/],
    ])('rejects %j', (raw, message) => {
      expect(() => parseServerConfig(raw)).toThrow(message);
    });

    it('allows plain http for a provider on localhost', () => {
      expect(parseServerConfig(oidc({ issuer: 'http://localhost:8180/realms/dev' })).auth.oidc?.issuer).toBe(
        'http://localhost:8180/realms/dev',
      );
    });
  });

  describe('auth.login', () => {
    const user = (entry: Record<string, unknown> = {}) => ({
      email: 'editor@example.com',
      passwordHash: BCRYPT,
      scopes: ['content:read'],
      ...entry,
    });
    const login = (extra: Record<string, unknown> = {}) =>
      withAuth({ login: { redirectUris: 'http://localhost:5173/admin/', users: [user()], ...extra } });

    it('accepts login alone, lowercasing emails and defaulting the client id', () => {
      expect(parseServerConfig(login({ users: [user({ email: 'Editor@Example.com', name: 'Ed' })] })).auth).toEqual({
        apiKeys: [],
        login: {
          redirectUris: ['http://localhost:5173/admin/'],
          clientId: 'contentia',
          users: [{ email: 'editor@example.com', name: 'Ed', passwordHash: BCRYPT, scopes: ['content:read'] }],
        },
      });
    });

    it.each([
      [login({ users: [user({ passwordHash: 'hunter2' })] }), /not the password itself/],
      [login({ users: [user({ passwordHash: BCRYPT.replace('$12$', '$10$') })] }), /bcrypt cost 10 is below 12/],
      [login({ users: [user({ email: 'editor' })] }), /users\[0\].email: "editor" is not an email address/],
      [login({ users: [user(), user({ email: 'EDITOR@example.com' })] }), /duplicate user "editor@example.com"/],
      [login({ users: [user({ scopes: [] })] }), /a user needs at least one scope/],
      [login({ users: [user({ password: 'x' })] }), /users\[0\].password: unknown setting/],
      [login({ users: [] }), /auth.login.users: must be a non-empty list/],
      [login({ redirectUris: undefined }), /auth.login.redirectUris: must be a non-empty/],
      [login({ redirectUris: ['/admin/'] }), /"\/admin\/" is not an http\(s\) URL/],
      [login({ redirectUris: ['javascript:alert(1)'] }), /is not an http\(s\) URL/],
    ])('rejects %j', (raw, message) => {
      expect(() => parseServerConfig(raw)).toThrow(message);
    });
  });
});

describe('loadServerConfig', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true })));
  });

  const write = async (name: string, contents: string) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contentia-config-'));
    dirs.push(dir);
    const file = path.join(dir, name);
    await fs.writeFile(file, contents);
    return { dir, file };
  };

  it('reads YAML, resolving env and file secrets after parsing', async () => {
    const { dir, file } = await write(
      'contentia.yaml',
      [
        'listen:',
        '  port: ${env:PORT:-8080}',
        'storage:',
        '  backend: github',
        '  options:',
        '    token: ${file:github-token}',
        '    owner: "${env:OWNER}"',
        'auth:',
        '  apiKeys:',
        `    - { name: build, sha256: ${HASH}, scopes: [content:read] }`,
      ].join('\n'),
    );
    // A secret containing YAML syntax must stay a plain string.
    await fs.writeFile(path.join(dir, 'github-token'), 'ghp_x\n  injected: true\n');
    const config = await loadServerConfig(file, { PORT: '9000', OWNER: 'acme' });
    expect(config.listen.port).toBe(9000);
    expect(config.storage.options).toEqual({ token: 'ghp_x\n  injected: true', owner: 'acme' });
  });

  it('takes the default listen host from CONTENTIA_LISTEN_HOST, but the config wins', async () => {
    const { file } = await write('contentia.json', JSON.stringify(minimal));
    expect((await loadServerConfig(file, { CONTENTIA_LISTEN_HOST: '0.0.0.0' })).listen.host).toBe('0.0.0.0');
    const pinned = await write('contentia.json', JSON.stringify({ ...minimal, listen: { host: '10.0.0.5' } }));
    expect((await loadServerConfig(pinned.file, { CONTENTIA_LISTEN_HOST: '0.0.0.0' })).listen.host).toBe('10.0.0.5');
  });

  it('keeps the $ signs of a bcrypt hash, inline or from the environment', async () => {
    const { file } = await write(
      'contentia.yaml',
      [
        'storage: { backend: fs }',
        'auth:',
        '  login:',
        '    redirectUris: [http://localhost:5173/admin/]',
        '    users:',
        `      - { email: a@example.com, passwordHash: ${BCRYPT}, scopes: [admin] }`,
        '      - { email: b@example.com, passwordHash: "${env:B_HASH}", scopes: [admin] }',
      ].join('\n'),
    );
    const config = await loadServerConfig(file, { B_HASH: BCRYPT });
    expect(config.auth.login?.users.map(u => u.passwordHash)).toEqual([BCRYPT, BCRYPT]);
  });

  it('reads JSON', async () => {
    const { file } = await write('contentia.json', JSON.stringify(minimal));
    expect((await loadServerConfig(file, {})).storage.backend).toBe('fs');
  });

  it('prefixes errors with the file path', async () => {
    const { file } = await write('contentia.yaml', 'storage: { backend: fs }\nauth: { apiKeys: [] }\n');
    await expect(loadServerConfig(file, {})).rejects.toThrow(`${file}: auth: configure auth.oidc`);
  });

  it('rejects unknown extensions and missing files', async () => {
    const { file } = await write('contentia.toml', '');
    await expect(loadServerConfig(file, {})).rejects.toThrow('unsupported config extension');
    await expect(loadServerConfig(`${file}.missing`, {})).rejects.toThrow('ENOENT');
  });
});
