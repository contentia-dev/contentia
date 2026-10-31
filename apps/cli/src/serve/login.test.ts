import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hashPassword } from 'contentia/crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ContentiaApi } from 'contentia/server/api';

import { buildServerApi, describeServerConfig, serverConfigWarnings } from './build.js';
import { parseServerConfig } from './config.js';
import { createTestIssuer, type TestIssuer } from './testing.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const ADMIN = 'https://admin.example.com/admin/';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

let root: string;
let idp: TestIssuer;
let passwordHash: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'contentia-login-'));
  idp = await createTestIssuer();
  // One bcrypt hash (cost 12) for every user keeps the suite fast.
  passwordHash = await hashPassword('correct horse');
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const configFor = (auth: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  parseServerConfig({
    storage: { backend: 'fs', options: { root, defaultExtension: 'json' } },
    auth: {
      login: {
        redirectUris: [ADMIN],
        users: [
          { email: 'Editor@Example.com', name: 'Ed', passwordHash, scopes: ['content:read', 'content:write'] },
          { email: 'viewer@example.com', passwordHash, scopes: ['content:read'] },
        ],
      },
      ...auth,
    },
    ...extra,
  });

const api = (config = configFor()) => buildServerApi(config, { fetch: idp.fetch, logger: silent });

const authorizeUrl = (params: Record<string, string> = {}) =>
  `http://cms.test/oauth2/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: 'contentia',
    redirect_uri: ADMIN,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    ...params,
  })}`;

const form = (body: Record<string, string>, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(body).toString(),
});

/** Submit the login form; the authorization code from the redirect, or the failed response. */
const signIn = async (server: ContentiaApi, email: string, password = 'correct horse', params = {}) => {
  const res = await server.fetch(new Request(authorizeUrl(params), form({ email, password })));
  if (res.status !== 302) return { res };
  const location = new URL(res.headers.get('location')!);
  return { res, location, code: location.searchParams.get('code')! };
};

const exchange = async (server: ContentiaApi, body: Record<string, string>, headers = {}) =>
  server.fetch(new Request('http://cms.test/oauth2/token', form({ client_id: 'contentia', ...body }, headers)));

const tokensFor = async (server: ContentiaApi, email: string, params = {}) => {
  const { code } = await signIn(server, email, 'correct horse', params);
  const res = await exchange(server, {
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: ADMIN,
    code_verifier: VERIFIER,
  });
  expect(res.status).toBe(200);
  return await res.json() as { access_token: string, refresh_token: string, scope: string };
};

const createPost = (token: string, id = 'posts/hello') =>
  new Request('http://cms.test/api/storage/objects', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.api+json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { type: 'object', id, attributes: { content: { title: 'Hi' } } } }),
  });
const readAtoms = (token: string) =>
  new Request('http://cms.test/api/storage/atoms', { headers: { authorization: `Bearer ${token}` } });
const session = (token: string) =>
  new Request('http://cms.test/api/session', { headers: { authorization: `Bearer ${token}` } });

describe('auth.login', () => {
  it('serves the login page for a registered redirect URI', async () => {
    const res = await (await api()).fetch(new Request(authorizeUrl()));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
  });

  it('signs a user in and grants the scopes from the config', async () => {
    const server = await api();
    const { location } = await signIn(server, 'editor@example.com');
    expect(location?.origin + location!.pathname).toBe(ADMIN);
    expect(location?.searchParams.get('state')).toBe('xyz');

    const editor = await tokensFor(server, 'editor@example.com');
    expect((await server.fetch(createPost(editor.access_token))).status).toBe(201);
    const me = await (await server.fetch(session(editor.access_token))).json();
    expect(me.data.attributes).toMatchObject({ email: 'editor@example.com', name: 'Ed' });
  });

  it('ignores the scope the client asks for', async () => {
    const server = await api();
    const viewer = await tokensFor(server, 'viewer@example.com', { scope: 'admin content:write' });
    expect(viewer.scope).toBe('content:read');
    expect((await server.fetch(readAtoms(viewer.access_token))).status).toBe(200);
    expect((await server.fetch(createPost(viewer.access_token, 'posts/viewer'))).status).toBe(403);
  });

  it('matches emails case-insensitively', async () => {
    const { code } = await signIn(await api(), 'EDITOR@example.COM');
    expect(code).toBeTruthy();
  });

  it('rejects a wrong password or an unknown user', async () => {
    const server = await api();
    expect((await signIn(server, 'editor@example.com', 'wrong')).res.status).toBe(401);
    expect((await signIn(server, 'nobody@example.com')).res.status).toBe(401);
  });

  it('refuses unregistered redirect URIs and client ids', async () => {
    const server = await api();
    const evil = await signIn(server, 'editor@example.com', 'correct horse', { redirect_uri: 'https://evil.test/' });
    expect(evil.res.status).toBe(400);
    const client = await signIn(server, 'editor@example.com', 'correct horse', { client_id: 'other' });
    expect(client.res.status).toBe(401);
  });

  it('redeems a code once, and only with its verifier', async () => {
    const server = await api();
    const { code } = await signIn(server, 'editor@example.com');
    const body = { grant_type: 'authorization_code', code: code!, redirect_uri: ADMIN };
    expect((await exchange(server, { ...body, code_verifier: 'w'.repeat(64) })).status).toBe(400);
    // A wrong verifier burns the code.
    expect((await exchange(server, { ...body, code_verifier: VERIFIER })).status).toBe(400);
  });

  it('rotates tokens on refresh', async () => {
    const server = await api();
    const first = await tokensFor(server, 'editor@example.com');
    const res = await exchange(server, { grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(res.status).toBe(200);
    const second = await res.json() as { access_token: string };
    expect((await server.fetch(readAtoms(second.access_token))).status).toBe(200);
    expect((await server.fetch(readAtoms(first.access_token))).status).toBe(401);
  });

  it('rejects expired access tokens', async () => {
    const server = await api();
    const { access_token } = await tokensFor(server, 'editor@example.com');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3601 * 1000);
    expect((await server.fetch(readAtoms(access_token))).status).toBe(401);
  });

  it('rejects made-up bearer tokens', async () => {
    expect((await (await api()).fetch(readAtoms('x'.repeat(128)))).status).toBe(401);
  });

  it("answers CORS on the token endpoint for the redirect URIs' origins only", async () => {
    const server = await api();
    const preflight = (origin: string) =>
      server.fetch(new Request('http://cms.test/oauth2/token', { method: 'OPTIONS', headers: { origin } }));
    const allowed = await preflight('https://admin.example.com');
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
    expect((await preflight('https://evil.test')).headers.get('access-control-allow-origin')).toBeNull();

    const { code } = await signIn(server, 'editor@example.com');
    const res = await exchange(
      server,
      { grant_type: 'authorization_code', code: code!, redirect_uri: ADMIN, code_verifier: VERIFIER },
      { origin: 'https://admin.example.com' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
  });

  it('still accepts OIDC tokens and API keys alongside', async () => {
    const server = await api(configFor({
      oidc: { issuer: idp.issuer, audience: 'contentia', defaultScopes: ['content:read'] },
      apiKeys: [{
        name: 'build',
        sha256: createHash('sha256').update('read-key').digest('hex'),
        scopes: ['content:read'],
      }],
    }));
    const jwt = await idp.sign({
      iss: idp.issuer,
      sub: 'user-1',
      aud: 'contentia',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    expect((await server.fetch(readAtoms(jwt))).status).toBe(200);
    const withKey = new Request('http://cms.test/api/storage/atoms', { headers: { 'x-api-key': 'read-key' } });
    expect((await server.fetch(withKey)).status).toBe(200);
  });

  it('warns that it is for testing, and about admin origins missing from cors', () => {
    const config = configFor({}, { cors: { origins: ['https://other.example.com'] } });
    expect(describeServerConfig(config)).toBe('fs storage, convention catalog, auth: login (2 users)');
    const warnings = serverConfigWarnings(config);
    expect(warnings[0]).toMatch(/^auth.login is for testing/);
    expect(warnings[1]).toMatch(/https:\/\/admin.example.com is not in cors.origins/);
    expect(serverConfigWarnings(configFor({}, { cors: { origins: ['https://admin.example.com'] } }))).toHaveLength(1);
  });
});
