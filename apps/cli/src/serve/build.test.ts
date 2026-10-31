import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { layerFetchServer } from '../server.js';
import { buildServerApi, describeServerConfig } from './build.js';
import { parseServerConfig, type ServerConfig } from './config.js';
import { createTestIssuer, type TestIssuer } from './testing.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const silent = { error() {}, warn() {}, info() {}, debug() {} };

let root: string;
let idp: TestIssuer;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'contentia-serve-'));
  idp = await createTestIssuer();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const configFor = (extra: Record<string, unknown> = {}): ServerConfig =>
  parseServerConfig({
    storage: { backend: 'fs', options: { root, defaultExtension: 'json' } },
    auth: {
      oidc: {
        issuer: idp.issuer,
        audience: 'contentia',
        rolesClaim: 'roles',
        roles: { editor: ['content:read', 'content:write', 'media:read', 'media:write'] },
        defaultScopes: ['content:read'],
      },
      apiKeys: [
        { name: 'build', sha256: sha256('read-key'), scopes: ['content:read'] },
        { name: 'importer', sha256: sha256('write-key'), scopes: ['content:read', 'content:write'] },
      ],
    },
    ...extra,
  });

const api = (config = configFor()) => buildServerApi(config, { fetch: idp.fetch, logger: silent });

const createPost = (headers: Record<string, string>) =>
  new Request('http://cms.test/api/storage/objects', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.api+json', ...headers },
    body: JSON.stringify({ data: { type: 'object', id: 'posts/hello', attributes: { content: { title: 'Hi' } } } }),
  });
const readPost = (headers: Record<string, string>) =>
  new Request('http://cms.test/api/storage/objects/posts%2Fhello', { headers });

const bearer = async (claims: Record<string, unknown> = {}) => ({
  authorization: `Bearer ${await idp.sign({
    iss: idp.issuer,
    sub: 'user-1',
    aud: 'contentia',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })}`,
});

describe('buildServerApi', () => {
  it('serves /health without credentials', async () => {
    const res = await (await api()).fetch(new Request('http://cms.test/api/health'));
    expect(res.status).toBe(200);
  });

  it('requires credentials everywhere else', async () => {
    const res = await (await api()).fetch(readPost({}));
    expect(res.status).toBe(401);
  });

  it('applies API key scopes: read-only keys cannot write', async () => {
    const server = await api();
    expect((await server.fetch(createPost({ 'x-api-key': 'read-key' }))).status).toBe(403);
    expect((await server.fetch(createPost({ 'x-api-key': 'write-key' }))).status).toBe(201);
    const res = await server.fetch(readPost({ 'x-api-key': 'read-key' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.attributes.content).toEqual({ title: 'Hi' });
    expect(await fs.readFile(path.join(root, 'posts', 'hello.json'), 'utf8')).toContain('"title": "Hi"');
  });

  it('rejects unknown API keys', async () => {
    expect((await (await api()).fetch(readPost({ 'x-api-key': 'guess' }))).status).toBe(401);
  });

  it('authenticates OIDC tokens and maps roles to scopes', async () => {
    const server = await api();
    // defaultScopes gives every valid token content:read, but not write.
    expect((await server.fetch(createPost(await bearer()))).status).toBe(403);
    expect((await server.fetch(createPost(await bearer({ roles: ['editor'] })))).status).toBe(201);
    expect((await server.fetch(readPost(await bearer()))).status).toBe(200);
  });

  it('rejects tokens for another audience or issuer', async () => {
    const server = await api();
    expect((await server.fetch(readPost(await bearer({ aud: 'other-app' })))).status).toBe(401);
    expect((await server.fetch(readPost(await bearer({ iss: 'https://evil.example.com' })))).status).toBe(401);
  });

  it('refuses bearer tokens when no OIDC provider is configured', async () => {
    const config = configFor({
      auth: { apiKeys: [{ name: 'build', sha256: sha256('read-key'), scopes: ['content:read'] }] },
    });
    expect((await (await api(config)).fetch(readPost(await bearer({ roles: ['editor'] })))).status).toBe(401);
  });

  it('honours basePath and leaves /assets off when disabled', async () => {
    const server = await api(configFor({ basePath: '/cms', assets: false }));
    expect((await server.fetch(new Request('http://cms.test/cms/health'))).status).toBe(200);
    // Outside basePath nothing is public: unknown paths authenticate before they 404.
    expect((await server.fetch(new Request('http://cms.test/api/health'))).status).toBe(401);
    const assets = await server.fetch(
      new Request('http://cms.test/cms/assets', { headers: { 'x-api-key': 'read-key' } }),
    );
    expect(assets.status).toBe(404);
  });

  it('answers CORS preflights for configured origins only', async () => {
    const server = await api(configFor({ cors: { origins: ['https://admin.example.com'] } }));
    const preflight = (origin: string) =>
      server.fetch(new Request('http://cms.test/api/storage/objects', { method: 'OPTIONS', headers: { origin } }));
    const allowed = await preflight('https://admin.example.com');
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
    expect((await preflight('https://evil.example.com')).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('describes the config without secrets', () => {
    expect(describeServerConfig(configFor())).toBe(
      `fs storage, convention catalog, auth: OIDC (${idp.issuer}) + 2 API keys`,
    );
  });
});

describe('layerFetchServer', () => {
  const fibers: Fiber.Fiber<unknown, unknown>[] = [];
  afterEach(async () => {
    await Promise.all(fibers.splice(0).map(f => Effect.runPromise(Fiber.interrupt(f))));
  });

  it('serves the API over HTTP', async () => {
    const server = await api();
    const url = await new Promise<string>((resolve, reject) => {
      const fiber = Effect.runFork(Layer.launch(layerFetchServer({
        fetch: request => server.fetch(request),
        port: 0,
        onListening: listening => Effect.sync(() => resolve(listening)),
      })));
      fibers.push(fiber);
      fiber.addObserver(exit => reject(exit));
    });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    expect(
      (await fetch(`${url}/api/storage/objects`, { method: 'POST', body: '{}', headers: { 'x-api-key': 'read-key' } }))
        .status,
    )
      .toBe(403);
    const created = await fetch(`${url}/api/storage/objects`, {
      method: 'POST',
      headers: { 'x-api-key': 'write-key', 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify({ data: { type: 'object', id: 'posts/over-http', attributes: { content: { ok: true } } } }),
    });
    expect(created.status).toBe(201);
  });
});
