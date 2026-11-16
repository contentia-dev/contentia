import { describe, expect, it, vi } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import type { CatalogProvider } from 'contentia/catalog';
import type { Catalog, DocumentCollectionSettings, MediaCollectionSettings } from 'contentia/catalog';
import { ContentiaTask, InternalError, NotFoundError } from 'contentia/core';

import { buildJsonApi } from './server.js';

// Minimal stub repo — routes that hit no repo methods (e.g. 404) need nothing.
const stubRepo = {} as CatalogProvider;

const docCollection: DocumentCollectionSettings = {
  type: 'document',
  key: 'posts',
  name: 'Posts',
};

const mediaCollection: MediaCollectionSettings = {
  type: 'media',
  key: 'images',
  name: 'Images',
};

const settingsWithBoth: Catalog = {
  collections: {
    posts: docCollection,
    images: mediaCollection,
  },
};

// ---------------------------------------------------------------------------
// Cache-Control
// ---------------------------------------------------------------------------

const JSON_API = 'application/vnd.api+json';

function jsonApiRequest(path: string, method: string, data: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': JSON_API },
    body: JSON.stringify({ data }),
  });
}

describe('catalog-api Cache-Control', () => {
  it('sends Cache-Control: no-store on 404 responses', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/does-not-exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on GET /collections', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('sends Cache-Control: no-store on writes, deletes, denials and the OpenAPI routes', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putCatalog: () => ContentiaTask.succeed(undefined),
      putDocumentCollectionSettings: () => ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });
    const denied = buildJsonApi({ repo, authorize: () => false });

    const responses = [
      await api.fetch(jsonApiRequest('/collections', 'POST', { type: 'document-collection', id: 'a', attributes: {} })),
      await api.fetch(jsonApiRequest('/collections', 'POST', { type: 'nope', id: 'a', attributes: {} })),
      await api.fetch(new Request('http://localhost/collections/posts', { method: 'DELETE' })),
      await api.fetch(new Request('http://localhost/openapi.json')),
      await api.fetch(new Request('http://localhost/openapi.yaml')),
      await denied.fetch(new Request('http://localhost/collections')),
    ];
    expect(responses.map(res => res.status)).toEqual([201, 400, 204, 200, 200, 403]);
    for (const res of responses) expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// Content-Type
// ---------------------------------------------------------------------------

describe('catalog-api Content-Type', () => {
  const repo = {
    getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    getDocumentCollectionSettings: () => ContentiaTask.succeed(docCollection),
    putDocumentCollectionSettings: () => ContentiaTask.succeed(undefined),
  } as unknown as CatalogProvider;

  it('answers JSON:API documents with application/vnd.api+json', async () => {
    const api = buildJsonApi({ repo, authorize: allowAll });
    const responses = [
      await api.fetch(new Request('http://localhost/collections')),
      await api.fetch(new Request('http://localhost/collections/posts')),
      await api.fetch(jsonApiRequest('/collections', 'POST', { type: 'document-collection', id: 'a', attributes: {} })),
      await api.fetch(jsonApiRequest('/collections/posts', 'PATCH', {
        type: 'document-collection',
        id: 'posts',
        attributes: {},
      })),
    ];
    expect(responses.map(res => res.status)).toEqual([200, 200, 201, 200]);
    for (const res of responses) expect(res.headers.get('Content-Type')).toBe(JSON_API);
  });

  it('answers error documents with application/vnd.api+json', async () => {
    const api = buildJsonApi({ repo, authorize: allowAll });
    const denied = buildJsonApi({ repo, authorize: () => false });
    const responses = [
      await api.fetch(new Request('http://localhost/collections/missing')),
      await api.fetch(new Request('http://localhost/collections', { method: 'POST', body: 'not-json' })),
      await denied.fetch(new Request('http://localhost/collections')),
    ];
    expect(responses.map(res => res.status)).toEqual([404, 400, 403]);
    for (const res of responses) expect(res.headers.get('Content-Type')).toBe(JSON_API);
  });

  it('serves the OpenAPI document, which is not a JSON:API document, as application/json', async () => {
    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// attributes.type — the collection type lives on the resource type only
// ---------------------------------------------------------------------------

describe('catalog-api attributes.type', () => {
  it('omits the domain type from response attributes', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    const body = await res.json() as { data: Array<{ type: string, attributes: Record<string, unknown> }> };
    expect(body.data.map(resource => resource.type).sort()).toEqual(['document-collection', 'media-collection']);
    for (const resource of body.data) expect(resource.attributes).not.toHaveProperty('type');
  });

  it('takes the collection type from data.type and ignores attributes.type', async () => {
    const put = vi.fn((_key: string, _settings: DocumentCollectionSettings) => ContentiaTask.succeed(undefined));
    const repo = { putDocumentCollectionSettings: put } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const withoutType = await api.fetch(
      jsonApiRequest('/collections', 'POST', { type: 'document-collection', id: 'a', attributes: { name: 'A' } }),
    );
    const withWrongType = await api.fetch(
      jsonApiRequest('/collections', 'POST', {
        type: 'document-collection',
        id: 'b',
        attributes: { type: 'media', name: 'B' },
      }),
    );

    expect([withoutType.status, withWrongType.status]).toEqual([201, 201]);
    expect(put.mock.calls.map(([, settings]) => settings)).toEqual([
      { type: 'document', key: 'a', name: 'A' },
      { type: 'document', key: 'b', name: 'B' },
    ]);
    const echoed = await withWrongType.json() as { data: { attributes: Record<string, unknown> } };
    expect(echoed.data.attributes).toEqual({ name: 'B' });
  });
});

// ---------------------------------------------------------------------------
// attributes.key — the collection key comes from data.id / the URL only
// ---------------------------------------------------------------------------

describe('catalog-api attributes.key', () => {
  function writeSpyRepo() {
    const putDocument = vi.fn((_key: string, _settings: DocumentCollectionSettings) =>
      ContentiaTask.succeed(undefined)
    );
    const putMedia = vi.fn((_key: string, _settings: MediaCollectionSettings) => ContentiaTask.succeed(undefined));
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putDocumentCollectionSettings: putDocument,
      putMediaCollectionSettings: putMedia,
    } as unknown as CatalogProvider;
    return { repo, putDocument, putMedia };
  }

  it.each(
    [
      ['document-collection', 'putDocument'],
      ['media-collection', 'putMedia'],
    ] as const,
  )('POST writes a %s under data.id, not attributes.key', async (type, spy) => {
    const spies = writeSpyRepo();
    const api = buildJsonApi({ repo: spies.repo, authorize: allowAll });

    const res = await api.fetch(
      jsonApiRequest('/collections', 'POST', { type, id: 'articles', attributes: { key: 'posts', name: 'A' } }),
    );

    expect(res.status).toBe(201);
    expect(spies[spy]).toHaveBeenCalledOnce();
    const [writtenKey, settings] = spies[spy].mock.calls[0]!;
    expect([writtenKey, settings.key]).toEqual(['articles', 'articles']);
    const body = await res.json() as { data: { id: string, attributes: Record<string, unknown> } };
    expect(body.data.id).toBe('articles');
    expect(body.data.attributes).not.toHaveProperty('key');
  });

  it('PATCH writes under the URL key, not attributes.key', async () => {
    const spies = writeSpyRepo();
    const api = buildJsonApi({ repo: spies.repo, authorize: allowAll });

    const res = await api.fetch(
      jsonApiRequest('/collections/posts', 'PATCH', {
        type: 'document-collection',
        id: 'posts',
        attributes: { key: 'images', name: 'Posts' },
      }),
    );

    expect(res.status).toBe(200);
    expect(spies.putDocument).toHaveBeenCalledOnce();
    const [writtenKey, settings] = spies.putDocument.mock.calls[0]!;
    expect([writtenKey, settings.key]).toEqual(['posts', 'posts']);
  });
});

// ---------------------------------------------------------------------------
// POST / PATCH echo the submitted resource
// ---------------------------------------------------------------------------

describe('catalog-api write responses', () => {
  it.each(
    [
      ['POST', '/collections', 201],
      ['PATCH', '/collections/posts', 200],
    ] as const,
  )('%s echoes the decoded submission without reading it back', async (method, path, status) => {
    const getDocumentCollectionSettings = vi.fn(() => ContentiaTask.succeed(docCollection));
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      getDocumentCollectionSettings,
      putDocumentCollectionSettings: () => ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });

    const res = await api.fetch(jsonApiRequest(path, method, {
      type: 'document-collection',
      id: 'posts',
      attributes: { name: 'Submitted', draftDirectory: 'drafts', ignored: true },
    }));

    expect(res.status).toBe(status);
    expect(getDocumentCollectionSettings).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      data: {
        type: 'document-collection',
        id: 'posts',
        attributes: { name: 'Submitted', unpublishedStatuses: { draft: { directory: 'drafts', name: 'Draft' } } },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// GET /collections — list
// ---------------------------------------------------------------------------

describe('GET /collections', () => {
  it('returns 200 with a data array', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: Array<{ type: string, id: string }> };
    expect(body.data).toHaveLength(2);
    const ids = body.data.map(d => d.id);
    expect(ids).toContain('posts');
    expect(ids).toContain('images');
  });

  it('returns 200 with empty data array when no collections', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it('returns 500 JSON:API error shape when repo throws InternalError', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.fail(new InternalError('storage unavailable')),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(500);

    const body = await res.json() as { errors: Array<{ status: string, code: string, title: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('500');
    expect(body.errors[0]!.code).toBe('internal_error');
    expect(body.errors[0]!.title).toBe('Internal Error');
  });
});

// ---------------------------------------------------------------------------
// GET /collections/:key — read one
// ---------------------------------------------------------------------------

describe('GET /collections/:key', () => {
  it('returns 200 with document-collection type for a document collection', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      getDocumentCollectionSettings: (_key: string) => ContentiaTask.succeed(docCollection),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections/posts'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('posts');
  });

  it('returns 200 with media-collection type for a media collection', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      getMediaCollectionSettings: (_key: string) => ContentiaTask.succeed(mediaCollection),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections/images'));
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('images');
  });

  it('returns 404 JSON:API error when collection key does not exist', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections/missing'));
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, code: string, title: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.code).toBe('not_found');
    expect(body.errors[0]!.title).toBe('Not Found');
    expect(body.errors[0]!.detail).toContain('missing');
  });
});

// ---------------------------------------------------------------------------
// POST /collections — create
// ---------------------------------------------------------------------------

describe('POST /collections', () => {
  it('returns 201 when creating a document collection', async () => {
    const repo = {
      putDocumentCollectionSettings: (_key: string, _settings: DocumentCollectionSettings) =>
        ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'articles',
            attributes: { name: 'Articles' },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('articles');
  });

  it('returns 201 when creating a media collection', async () => {
    const repo = {
      putMediaCollectionSettings: (_key: string, _settings: MediaCollectionSettings) =>
        ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'videos',
            attributes: { name: 'Videos' },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('videos');
  });

  it('returns 400 JSON:API error on invalid request body', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'unknown-type', id: 'x', attributes: {} } }),
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
  });
});

// ---------------------------------------------------------------------------
// PATCH /collections/:key — update
// ---------------------------------------------------------------------------

describe('PATCH /collections/:key', () => {
  it('returns 200 when updating a document collection', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putDocumentCollectionSettings: (_key: string, _settings: DocumentCollectionSettings) =>
        ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'posts',
            attributes: { name: 'Blog Posts' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('document-collection');
    expect(body.data.id).toBe('posts');
  });

  it('returns 200 when updating a media collection', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putMediaCollectionSettings: (_key: string, _settings: MediaCollectionSettings) =>
        ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'images',
            attributes: { name: 'Updated Images' },
          },
        }),
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { type: string, id: string } };
    expect(body.data.type).toBe('media-collection');
    expect(body.data.id).toBe('images');
  });

  it('returns 404 JSON:API error when PATCH targets a non-existent collection key', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/ghost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'ghost',
            attributes: { name: 'Ghost' },
          },
        }),
      }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.detail).toContain('ghost');
  });

  it('returns 400 JSON:API error on invalid request body', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
    );
    expect(res.status).toBe(400);

    const body = await res.json() as { errors: Array<{ status: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('400');
  });

  it('returns 409 Conflict when body data.id differs from URL :key (document)', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'articles',
            attributes: { name: 'Articles' },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('409');
    expect(body.errors[0]!.detail).toContain('articles');
    expect(body.errors[0]!.detail).toContain('posts');
  });

  it('returns 409 Conflict when body data.id differs from URL :key (media)', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
    } as unknown as CatalogProvider;
    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'videos',
            attributes: { name: 'Videos' },
          },
        }),
      }),
    );
    expect(res.status).toBe(409);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('409');
    expect(body.errors[0]!.detail).toContain('videos');
    expect(body.errors[0]!.detail).toContain('images');
  });
});

// ---------------------------------------------------------------------------
// DELETE /collections/:key — delete
// ---------------------------------------------------------------------------

describe('DELETE /collections/:key', () => {
  it('returns 204 with no body on successful delete', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putCatalog: (_settings: Catalog) => ContentiaTask.succeed(undefined),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 404 JSON:API error when deleting a non-existent collection', async () => {
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/ghost', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);

    const body = await res.json() as { errors: Array<{ status: string, detail: string }> };
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.status).toBe('404');
    expect(body.errors[0]!.detail).toContain('ghost');
  });
});

// ---------------------------------------------------------------------------
// onError callback
// ---------------------------------------------------------------------------

describe('catalog-api onError', () => {
  it('calls onError when getCatalog fails on GET /collections', async () => {
    const onError = vi.fn();
    const repo = {
      getCatalog: () => ContentiaTask.fail(new InternalError('storage unavailable')),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(InternalError);
  });

  it('calls onError when getCatalog fails on GET /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getCatalog: () => ContentiaTask.fail(new InternalError('storage unavailable')),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections/posts'));
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('calls onError when collection is not found (404) on GET /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getCatalog: () => ContentiaTask.succeed({ collections: {} }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections/missing'));
    expect(res.status).toBe(404);
    expect(onError).toHaveBeenCalledOnce();
    const [calledWith] = onError.mock.calls[0]!;
    expect(calledWith).toBeInstanceOf(NotFoundError);
  });

  it('calls onError when putDocumentCollectionSettings fails on POST /collections', async () => {
    const onError = vi.fn();
    const repo = {
      putDocumentCollectionSettings: () => ContentiaTask.fail(new InternalError('write failed')),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'new-col',
            attributes: { name: 'New Col' },
          },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('calls onError when getCatalog fails on DELETE /collections/:key', async () => {
    const onError = vi.fn();
    const repo = {
      getCatalog: () => ContentiaTask.fail(new InternalError('storage unavailable')),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  // LCMS-384: POST /collections — media branch write failure
  it('calls onError when putMediaCollectionSettings fails on POST /collections', async () => {
    const onError = vi.fn();
    const put = vi.fn(() => ContentiaTask.fail(new InternalError('write failed')));
    const repo = {
      putMediaCollectionSettings: put,
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'uploads',
            attributes: { name: 'Uploads' },
          },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(InternalError);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('write failed');
  });

  // LCMS-367: PATCH /collections/:key — document branch write failure
  it('calls onError when putDocumentCollectionSettings fails on PATCH /collections/:key', async () => {
    const onError = vi.fn();
    const put = vi.fn(() => ContentiaTask.fail(new InternalError('write failed')));
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putDocumentCollectionSettings: put,
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'posts',
            attributes: { name: 'Posts' },
          },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(InternalError);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('write failed');
  });

  // LCMS-367: PATCH /collections/:key — media branch write failure
  it('calls onError when putMediaCollectionSettings fails on PATCH /collections/:key', async () => {
    const onError = vi.fn();
    const put = vi.fn(() => ContentiaTask.fail(new InternalError('write failed')));
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putMediaCollectionSettings: put,
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/images', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'media-collection',
            id: 'images',
            attributes: { name: 'Images' },
          },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(InternalError);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('write failed');
  });

  // LCMS-368: DELETE /collections/:key — putCatalog write failure after collection found
  it('calls onError when putCatalog fails on DELETE /collections/:key (write after lookup)', async () => {
    const onError = vi.fn();
    const put = vi.fn(() => ContentiaTask.fail(new InternalError('write failed')));
    const repo = {
      getCatalog: () => ContentiaTask.succeed(settingsWithBoth),
      putCatalog: put,
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, onError, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    );
    expect(res.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(InternalError);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('write failed');
  });
});

// ---------------------------------------------------------------------------
// global app.onError — NetworkingError → 503 + logger option
// ---------------------------------------------------------------------------

describe('catalog-api global error handler', () => {
  it('returns 503 service_unavailable JSON:API shape on NetworkingError', async () => {
    const networkingErr = Object.assign(new Error('ECONNREFUSED'), { name: 'NetworkingError' });
    const repo = {
      getCatalog: () =>
        ContentiaTask.make(() => {
          throw networkingErr;
        }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/collections'));
    expect(res.status).toBe(503);

    const body = await res.json() as { errors: Array<{ status: string, code: string, title: string }> };
    expect(body.errors[0]!.status).toBe('503');
    expect(body.errors[0]!.code).toBe('service_unavailable');
    expect(body.errors[0]!.title).toBe('Service Unavailable');
  });

  it('routes error details through a custom logger and does not call console.error', async () => {
    const customLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const networkingErr = Object.assign(new Error('connect timeout'), { name: 'NetworkingError' });
    const repo = {
      getCatalog: () =>
        ContentiaTask.make(() => {
          throw networkingErr;
        }),
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, logger: customLogger, authorize: allowAll });
    await api.fetch(new Request('http://localhost/collections'));

    expect(customLogger.error).toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Shorthand directory fields — LCMS-462
// ---------------------------------------------------------------------------

describe('document-collection shorthand directory fields', () => {
  it('merges draftDirectory/archiveDirectory/trashDirectory into unpublishedStatuses on POST', async () => {
    let captured: DocumentCollectionSettings | undefined;
    const repo = {
      putDocumentCollectionSettings: (_key: string, settings: DocumentCollectionSettings) => {
        captured = settings;
        return ContentiaTask.succeed(undefined);
      },
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'posts',
            attributes: {
              draftDirectory: 'my-drafts',
              archiveDirectory: 'my-archive',
              trashDirectory: 'my-trash',
            },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(captured?.unpublishedStatuses).toEqual({
      draft: { directory: 'my-drafts', name: 'Draft' },
      archived: { directory: 'my-archive', name: 'Archived' },
      trash: { directory: 'my-trash', name: 'Trash' },
    });
  });

  it('explicit unpublishedStatuses wins over shorthand for the same key', async () => {
    let captured: DocumentCollectionSettings | undefined;
    const repo = {
      putDocumentCollectionSettings: (_key: string, settings: DocumentCollectionSettings) => {
        captured = settings;
        return ContentiaTask.succeed(undefined);
      },
    } as unknown as CatalogProvider;

    const api = buildJsonApi({ repo, authorize: allowAll });
    const res = await api.fetch(
      new Request('http://localhost/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'document-collection',
            id: 'posts',
            attributes: {
              draftDirectory: 'shorthand-drafts',
              unpublishedStatuses: {
                draft: { directory: 'explicit-drafts', name: 'My Drafts' },
              },
            },
          },
        }),
      }),
    );
    expect(res.status).toBe(201);
    // Explicit unpublishedStatuses.draft beats the draftDirectory shorthand.
    expect(captured?.unpublishedStatuses?.draft).toEqual({ directory: 'explicit-drafts', name: 'My Drafts' });
  });
});
