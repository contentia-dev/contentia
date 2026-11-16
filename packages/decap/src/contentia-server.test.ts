/**
 * The backend against a real Contentia server: `contentiaApi` runs in-process
 * and `fetch` is routed into it, so the JSON:API proxies, `/session`,
 * `/health` and `/locks` all run unmocked. The first suite serves what
 * `createEmbeddedContentia` wires: the Decap catalog over filesystem storage,
 * for documents and media alike. The second serves the Decap guide's server:
 * the convention catalog over JSON files, `R2AssetsRepository` over an
 * in-memory bucket for media, and in-process locks.
 *
 * Decap's own modules are replaced with minimal stand-ins, as in the unit
 * tests: they load the UI graph at module scope, and `lib/backend`'s
 * published build does not load under plain Node.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AssetsRepository } from 'contentia/assets';
import { CatalogAssetsRepository } from 'contentia/assets/catalog';
import { assetsContractRegistry } from 'contentia/assets/testing';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { AuthenticationError } from 'contentia/core';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { InProcessLockManager } from 'contentia/locks/in-process';
import { jsonSerializer } from 'contentia/serializers/json';
import { contentiaApi } from 'contentia/server/api';
import { createEmbeddedContentia } from 'contentia/server/decap';
import { FileSystemStorageRepository } from 'contentia/storage/fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@laikacms/decap-cms/lib/util', () => {
  class APIError extends Error {
    name = 'API_ERROR';
    constructor(message: string, public status?: number, public api?: string) {
      super(message);
    }
  }
  class AccessTokenError extends Error {
    name = 'ACCESS_TOKEN_ERROR';
  }
  class Cursor {
    constructor(public readonly store: Record<string, unknown>) {}
    static create(store: Record<string, unknown>) {
      return new Cursor(store);
    }
  }
  return {
    APIError,
    AccessTokenError,
    Cursor,
    CURSOR_COMPATIBILITY_SYMBOL: Symbol('cursor'),
    unsentRequest: { fetchWithTimeout: (url: string, init?: RequestInit) => fetch(url, init) },
  };
});
vi.mock('@laikacms/decap-cms/lib/backend', () => ({
  rawContent: (raw: string) => ({ kind: 'raw', raw }),
  parsedContent: (data: Record<string, unknown>) => ({ kind: 'parsed', data }),
}));
vi.mock('@laikacms/decap-cms/lib/auth', () => ({}));
vi.mock('@laikacms/decap-cms/ui-default', () => ({}));

import createContentiaBackend from './contentia-backend.js';

const DEV_TOKEN = 'integration-dev-token';
const EDITOR = { id: 'editor', email: 'editor@example.com', name: 'Editor' };

const decapConfig = {
  backend: {
    name: 'contentia',
    base_url: 'http://contentia.test',
    api_root: '/api',
    dev_token: DEV_TOKEN,
  },
  media_folder: 'uploads',
  public_folder: 'uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: 'posts',
      format: 'json',
      create: true,
      fields: [{ name: 'title', label: 'Title', widget: 'string' }],
    },
  ],
};

const save = { useWorkflow: false, collectionName: 'posts' };

const inMemoryR2Assets = () => {
  const r2 = assetsContractRegistry.find(c => c.name.startsWith('R2AssetsRepository'));
  if (!r2) throw new Error('R2AssetsRepository contract case not found');
  return r2.makeRepo();
};

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });

describe('ContentiaBackend against createEmbeddedContentia', () => {
  let contentDir: string;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let backend: any;
  const warnings: unknown[] = [];

  const newBackend = async () => {
    const ContentiaBackend = createContentiaBackend({ onWarning: error => warnings.push(error) });
    const instance = new ContentiaBackend(decapConfig as any) as any;
    await instance.restoreUser();
    return instance;
  };

  beforeEach(async () => {
    contentDir = await mkdtemp(join(tmpdir(), 'contentia-decap-'));
    const embedded = createEmbeddedContentia({ contentDir, decapConfig });
    await embedded.ensureReady();

    const api = contentiaApi({
      documents: embedded.documents,
      storage: embedded.storage,
      assets: embedded.assets,
      basePath: '/api',
      authenticateAccessToken: async token => {
        if (token !== DEV_TOKEN) throw new AuthenticationError('Unknown token');
        return EDITOR;
      },
      authorize: () => true,
    });
    fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, init)));
    vi.stubGlobal('fetch', fetchSpy);

    warnings.length = 0;
    backend = await newBackend();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(contentDir, { recursive: true, force: true });
  });

  it('logs in with the dev token and reads the user from /session', async () => {
    expect(await backend.restoreUser()).toMatchObject({ name: 'Editor', login: 'editor@example.com' });
  });

  it('rejects a token the server does not accept', async () => {
    // Without dev_token, which would otherwise stand in for any token handed in.
    const { dev_token: _devToken, ...oauthBackend } = decapConfig.backend;
    const ContentiaBackend = createContentiaBackend();
    const stranger = new ContentiaBackend({ ...decapConfig, backend: oauthBackend } as any) as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(stranger.authenticate({ token: 'wrong-token' })).rejects.toMatchObject({ status: 401 });
    expect(() => stranger.getDocumentsRepo()).toThrow('Not authenticated');
  });

  it('reports the API as up', async () => {
    expect(await backend.status()).toEqual({
      auth: { status: true },
      api: { status: true, statusPage: 'http://contentia.test/api' },
    });
  });

  it('creates, lists, reads, updates and deletes an entry', async () => {
    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/hello.json', raw: JSON.stringify({ title: 'Hello' }) }], assets: [] },
      { ...save, newEntry: true },
    );

    const listed = await backend.entriesByFolder('posts', 'json', 1);
    expect(listed.map((entry: any) => entry.file.path)).toEqual(['posts/hello']);

    // On update Decap hands back the path it read, which has no extension.
    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/hello', raw: JSON.stringify({ title: 'Hello again' }) }], assets: [] },
      { ...save, newEntry: false },
    );
    // getEntry caches for a few seconds; a fresh backend reads the store.
    const reader = await newBackend();
    expect((await reader.getEntry('posts/hello.json')).content).toMatchObject({
      kind: 'parsed',
      data: { title: 'Hello again' },
    });

    await backend.deleteFiles(['posts/hello'], 'Delete hello');
    await expect((await newBackend()).getEntry('posts/hello', false)).rejects.toMatchObject({ status: 404 });
    expect(warnings).toEqual([]);
  });

  it('uploads media into media_folder, lists it, reads it back and deletes it', async () => {
    const uploaded = await backend.persistMedia({ path: 'uploads/logo.png', fileObj: png() }, save);
    expect(uploaded).toMatchObject({
      id: 'uploads/logo.png',
      name: 'logo.png',
      path: 'uploads/logo.png',
      url: 'uploads/logo.png',
      size: 4,
    });
    // The catalog stores it as an object inside the media folder.
    expect((await readdir(join(contentDir, 'uploads'))).map(name => name.split('.').slice(0, 2).join('.'))).toEqual([
      'logo.png',
    ]);

    const media = await backend.getMedia();
    expect(media.map((file: any) => [file.id, file.path])).toEqual([['uploads/logo.png', 'uploads/logo.png']]);

    const file = await (await newBackend()).getMediaFile('uploads/logo.png');
    expect(file).toMatchObject({ id: 'uploads/logo.png', path: 'uploads/logo.png' });
    expect(file.file.type).toBe('image/png');

    await backend.deleteFiles(['uploads/logo.png'], 'Delete logo');
    expect(await backend.getMedia()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('degrades locking to unsupported against a store that cannot lock, then stops calling /locks', async () => {
    const owner = { id: EDITOR.email, name: EDITOR.name };

    expect(await backend.acquireEntryLock('posts/hello', owner)).toBeNull();
    const calls = fetchSpy.mock.calls.length;

    expect(await backend.getEntryLock('posts/hello')).toBeNull();
    expect(await backend.acquireEntryLock('posts/other', owner)).toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });
});

/**
 * The server the Decap guide (docs/guides/decap.md) shows: the API Server guide's convention
 * catalog over JSON files, a flat assets store, and in-process locks. Guards that example.
 */
describe('ContentiaBackend against the Decap guide server', () => {
  let contentDir: string;
  let assets: AssetsRepository;
  let backend: any;

  const newBackend = async (token = DEV_TOKEN, backendSettings: Record<string, unknown> = {}) => {
    const ContentiaBackend = createContentiaBackend();
    const instance = new ContentiaBackend(
      { ...decapConfig, backend: { ...decapConfig.backend, dev_token: token, ...backendSettings } } as any,
    ) as any;
    await instance.restoreUser();
    return instance;
  };

  const assetKeys = async () =>
    (await assets.listResources('', { depth: Infinity, pagination: { limit: 100, offset: 0 } }).collect()).items
      .filter(resource => resource.type === 'asset')
      .map(resource => resource.key);

  beforeEach(async () => {
    contentDir = await mkdtemp(join(tmpdir(), 'contentia-decap-guide-'));
    const storage = new FileSystemStorageRepository(contentDir, { json: jsonSerializer }, 'json');
    const catalog = new ConventionCatalogProvider({ storage });
    assets = await inMemoryR2Assets();

    const api = contentiaApi({
      documents: new CatalogDocumentsRepository(storage, catalog),
      storage,
      assets,
      locks: new InProcessLockManager(),
      basePath: '/api',
      authenticateAccessToken: async token => {
        if (token === DEV_TOKEN) return EDITOR;
        if (token === 'other-token') return { id: 'other', email: 'other@example.com', name: 'Other' };
        throw new AuthenticationError('Unknown token');
      },
      authorize: () => true,
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, init)));
    backend = await newBackend();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(contentDir, { recursive: true, force: true });
  });

  it('stores a JSON entry as a .json file under the collection folder', async () => {
    await backend.persistEntry(
      { dataFiles: [{ path: 'posts/hello.json', raw: JSON.stringify({ title: 'Hello' }) }], assets: [] },
      { ...save, newEntry: true },
    );

    expect(JSON.parse(await readFile(join(contentDir, 'posts', 'hello.json'), 'utf8'))).toMatchObject({
      title: 'Hello',
    });
    const listed = await backend.entriesByFolder('posts', 'json', 1);
    expect(listed.map((entry: any) => entry.file.path)).toEqual(['posts/hello']);
    expect((await (await newBackend()).getEntry('posts/hello.json')).content).toMatchObject({
      data: { title: 'Hello' },
    });
  });

  it('keys media below media_folder in the bucket', async () => {
    await backend.persistMedia({ path: 'uploads/logo.png', fileObj: png() }, save);

    expect(await assetKeys()).toEqual(['uploads/logo.png']);
    expect((await backend.getMedia()).map((file: any) => file.path)).toEqual(['uploads/logo.png']);
  });

  it('keys media by file name with assets_folder set to the bucket root', async () => {
    const flat = await newBackend(DEV_TOKEN, { assets_folder: '' });

    const uploaded = await flat.persistMedia({ path: 'uploads/logo.png', fileObj: png() }, save);
    expect(uploaded).toMatchObject({ id: 'logo.png', name: 'logo.png', path: 'uploads/logo.png', size: 4 });
    expect(await assetKeys()).toEqual(['logo.png']);

    expect((await flat.getMedia()).map((file: any) => file.path)).toEqual(['uploads/logo.png']);
    expect(await flat.getMediaFile('uploads/logo.png')).toMatchObject({ id: 'logo.png', path: 'uploads/logo.png' });

    await flat.deleteFiles(['uploads/logo.png'], 'Delete logo');
    expect(await assetKeys()).toEqual([]);
  });

  it('locks an entry for its editor and shows the lock to another editor', async () => {
    const owner = { id: EDITOR.email, name: EDITOR.name };
    const other = await newBackend('other-token');

    expect(await backend.acquireEntryLock('posts/hello', owner)).toMatchObject({
      path: 'posts/hello',
      owner: { name: 'Editor' },
    });
    expect(await backend.refreshEntryLock('posts/hello', owner)).toMatchObject({ path: 'posts/hello' });

    await expect(other.acquireEntryLock('posts/hello', { id: 'other', name: 'Other' })).rejects.toMatchObject({
      status: 423,
    });
    expect(await other.getEntryLock('posts/hello')).toMatchObject({ owner: { name: 'Editor' } });

    await backend.releaseEntryLock('posts/hello', owner);
    expect(await other.getEntryLock('posts/hello')).toBeNull();
  });
});

/**
 * The repositories the Vite plugin's local API serves (`createRepositories`): the convention
 * catalog over filesystem storage for documents and media alike.
 */
describe('ContentiaBackend against the convention catalog assets repository', () => {
  let contentDir: string;

  beforeEach(async () => {
    contentDir = await mkdtemp(join(tmpdir(), 'contentia-decap-convention-'));
    const storage = new FileSystemStorageRepository(contentDir, { json: jsonSerializer }, 'json');
    const catalog = new ConventionCatalogProvider({ storage });
    const api = contentiaApi({
      documents: new CatalogDocumentsRepository(storage, catalog),
      storage,
      assets: new CatalogAssetsRepository(storage, catalog),
      basePath: '/api',
      authenticateAccessToken: async () => EDITOR,
      authorize: () => true,
    });
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(new Request(input, init)));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(contentDir, { recursive: true, force: true });
  });

  it('uploads media into media_folder, lists it, reads it back and deletes it', async () => {
    const ContentiaBackend = createContentiaBackend();
    const backend = new ContentiaBackend(decapConfig as any) as any;
    await backend.restoreUser();

    await backend.persistMedia({ path: 'uploads/logo.png', fileObj: png() }, save);
    expect((await backend.getMedia()).map((file: any) => [file.id, file.path])).toEqual([
      ['uploads/logo.png', 'uploads/logo.png'],
    ]);
    expect((await backend.getMediaFile('uploads/logo.png')).file.type).toBe('image/png');

    await backend.deleteFiles(['uploads/logo.png'], 'Delete logo');
    expect(await backend.getMedia()).toEqual([]);
  });
});
