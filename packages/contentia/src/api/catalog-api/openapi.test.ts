import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import type { CatalogProvider } from 'contentia/catalog';
import { ContentiaTask, InternalError, NotImplementedError, TooManyRequestsError } from 'contentia/core';
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiPathItem,
  OpenApiRef,
  OpenApiResponse,
  OpenApiSchema,
} from 'contentia/json-api';

import { buildCatalogOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// Minimal stub repo — /openapi.json hits no repo methods.
const stubRepo = {} as CatalogProvider;

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

function operationsOf(pathItem: OpenApiPathItem): OpenApiOperation[] {
  return HTTP_METHODS.flatMap(method => pathItem[method] ? [pathItem[method]] : []);
}

/** A response with any `$ref` resolved, keeping the referencing site's own description. */
function resolveResponse(doc: OpenApiDocument, response: OpenApiResponse | OpenApiRef): OpenApiResponse {
  if (!('$ref' in response)) return response;
  const target = doc.components?.responses?.[response.$ref.split('/').pop()!];
  expect(target, `dangling ${response.$ref}`).toBeDefined();
  return { ...target!, ...(response.description ? { description: response.description } : {}) };
}

function responsesOf(doc: OpenApiDocument): Array<[label: string, response: OpenApiResponse]> {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap(method =>
      Object.entries(item[method]?.responses ?? {}).map(([status, response]) =>
        [`${method.toUpperCase()} ${path} ${status}`, resolveResponse(doc, response)] as [string, OpenApiResponse]
      )
    )
  );
}

// ---------------------------------------------------------------------------
// GET /openapi.json — served document
// ---------------------------------------------------------------------------

describe('GET /openapi.json', () => {
  it('returns 200 with application/json', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Catalog API');
    expect(doc.info.version).toBe('1.0.1');
  });

  it('rewrites servers[0].url to the request origin', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com');
  });

  it('reflects a custom basePath in servers[0].url', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/catalog', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/catalog/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/catalog');
  });

  it('serves openapi.json under a non-root basePath (not at the root path)', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/catalog', authorize: allowAll });
    const mounted = await api.fetch(new Request('https://cms.example.com/api/catalog/openapi.json'));
    expect(mounted.status).toBe(200);
    const root = await api.fetch(new Request('https://cms.example.com/openapi.json'));
    expect(root.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.yaml — served document
// ---------------------------------------------------------------------------

describe('GET /openapi.yaml', () => {
  it('returns 200 with application/yaml', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/yaml');
  });

  it('serves the same OpenAPI document as YAML with servers[0].url rewritten', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/openapi.yaml'));
    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Catalog API');
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com');
  });
});

// ---------------------------------------------------------------------------
// buildCatalogOpenApi — document structure
// ---------------------------------------------------------------------------

describe('buildCatalogOpenApi', () => {
  it('lists exactly the implemented routes as paths', () => {
    const doc = buildCatalogOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/collections',
      '/collections/{key}',
      '/openapi.json',
      '/openapi.yaml',
    ]);
  });

  it('documents exactly the implemented methods per path', () => {
    const doc = buildCatalogOpenApi();
    const methodsOf = (path: string) => HTTP_METHODS.filter(method => doc.paths[path]?.[method]).sort();
    expect(methodsOf('/openapi.json')).toEqual(['get']);
    expect(methodsOf('/collections')).toEqual(['get', 'post']);
    expect(methodsOf('/collections/{key}')).toEqual(['delete', 'get', 'patch']);
  });

  it('gives every operation an operationId and responses', () => {
    const doc = buildCatalogOpenApi();
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.operationId).toBeTruthy();
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it('defaults servers[0].url to /', () => {
    const doc = buildCatalogOpenApi();
    expect(doc.servers?.[0]?.url).toBe('/');
  });

  it('reflects a custom basePath in servers while keeping paths relative', () => {
    const doc = buildCatalogOpenApi({ basePath: '/api/catalog' });
    expect(doc.servers?.[0]?.url).toBe('/api/catalog');
    for (const path of Object.keys(doc.paths)) {
      expect(path.startsWith('/api/catalog')).toBe(false);
    }
  });

  it('declares a 403 on every operation, since authorize runs before each one', () => {
    const doc = buildCatalogOpenApi();
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method];
        if (!operation) continue;
        const forbidden = operation.responses['403'];
        expect(forbidden, `${method} ${path}`).toBeDefined();
        const response = resolveResponse(doc, forbidden!);
        expect(response.description).toBe('The access policy denied this action.');
        expect(Object.keys(response.content ?? {})).toEqual(['application/vnd.api+json']);
      }
    }
  });

  it('declares Cache-Control: no-store on every response', () => {
    const doc = buildCatalogOpenApi();
    const responses = responsesOf(doc);
    expect(responses.length).toBeGreaterThan(0);
    for (const [label, response] of responses) {
      expect(response.headers?.['Cache-Control']?.schema, label).toEqual({ type: 'string', const: 'no-store' });
    }
  });

  it('folds every error response into the ErrorResponse component', () => {
    const doc = buildCatalogOpenApi();
    const errorRefs = Object.values(doc.paths)
      .flatMap(operationsOf)
      .flatMap(operation => Object.entries(operation.responses))
      .filter(([status]) => status === 'default' || Number(status) >= 400)
      .map(([, response]) => '$ref' in response ? response.$ref : 'inline');
    expect(new Set(errorRefs)).toEqual(new Set(['#/components/responses/ErrorResponse']));
  });

  it('declares a default error response for settings-provider failures on every collection operation', () => {
    const doc = buildCatalogOpenApi();
    for (const path of ['/collections', '/collections/{key}']) {
      for (const operation of operationsOf(doc.paths[path]!)) {
        const fallback = operation.responses['default'];
        expect(fallback, operation.operationId).toBeDefined();
        expect(resolveResponse(doc, fallback!).description).toMatch(/settings provider failed/);
      }
    }
  });

  it('declares 503 on every operation that calls the settings provider', () => {
    // A thrown NetworkingError/TimeoutError from the provider reaches the shared 503 handler.
    const doc = buildCatalogOpenApi();
    const with503 = Object.values(doc.paths)
      .flatMap(operationsOf)
      .filter(operation => operation.responses['503'])
      .map(operation => operation.operationId)
      .sort();
    expect(with503).toEqual([
      'createCollection',
      'deleteCollection',
      'getCollection',
      'listCollections',
      'updateCollection',
    ]);
  });

  it('keeps the domain type out of collection attributes', () => {
    // toJsonApi strips `type` from response attributes, and the request
    // decoders take the collection type from data.type alone.
    const schemas = buildCatalogOpenApi().components?.schemas ?? {};
    for (const name of ['DocumentCollectionAttributes', 'MediaCollectionAttributes']) {
      const schema = schemas[name] as OpenApiSchema & { properties: Record<string, unknown>, required?: string[] };
      expect(Object.keys(schema.properties), name).not.toContain('type');
      expect(schema.required ?? [], name).not.toContain('type');
    }
  });

  it('says that POST and PATCH echo the submission rather than reading it back', () => {
    const doc = buildCatalogOpenApi();
    const created = resolveResponse(doc, doc.paths['/collections']!.post!.responses['201']!);
    const updated = resolveResponse(doc, doc.paths['/collections/{key}']!.patch!.responses['200']!);
    for (const response of [created, updated]) {
      expect(response.description).toMatch(/echoed back/);
      expect(response.description).toMatch(/not read back from the settings provider/);
    }
  });

  it('says the served OpenAPI document has its servers rewritten', () => {
    const doc = buildCatalogOpenApi();
    for (const path of ['/openapi.json', '/openapi.yaml']) {
      const ok = resolveResponse(doc, doc.paths[path]!.get!.responses['200']!);
      expect(ok.description, path).toMatch(/`servers` set to the request origin plus the mount path/);
    }
  });

  it('states that access is decided by the required policy, not open by default', () => {
    const { description = '' } = buildCatalogOpenApi().info;
    expect(description).toContain('requires an access policy (`authorize`)');
    expect(description).toContain('authenticates no one itself');
    expect(description).not.toMatch(/ships no built-in authentication/);
  });

  it('resolves every $ref to a declared component schema', () => {
    const doc = buildCatalogOpenApi();
    const schemas = doc.components?.schemas ?? {};
    const refs = JSON.stringify(doc).match(/"#\/components\/schemas\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref.slice('"#/components/schemas/'.length, -1);
      expect(schemas[name], `missing component schema '${name}'`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Error statuses the handler answers vs. the statuses the spec declares
// ---------------------------------------------------------------------------

describe('declared error statuses', () => {
  const doc = buildCatalogOpenApi();
  const body = JSON.stringify({ data: { type: 'document-collection', id: 'posts', attributes: {} } });
  const operations = [
    ['listCollections', '/collections', 'get', () => new Request('http://localhost/collections')],
    [
      'createCollection',
      '/collections',
      'post',
      () => new Request('http://localhost/collections', { method: 'POST', body }),
    ],
    ['getCollection', '/collections/{key}', 'get', () => new Request('http://localhost/collections/posts')],
    [
      'updateCollection',
      '/collections/{key}',
      'patch',
      () => new Request('http://localhost/collections/posts', { method: 'PATCH', body }),
    ],
    [
      'deleteCollection',
      '/collections/{key}',
      'delete',
      () => new Request('http://localhost/collections/posts', { method: 'DELETE' }),
    ],
  ] as const;

  const responsesFor = (path: string, method: (typeof operations)[number][2]) => doc.paths[path]![method]!.responses;

  // Every provider method the handler calls fails with `error`; getCatalog
  // succeeds when `catalogOk` so the per-collection reads and writes are reached.
  function failingRepo(error: () => ReturnType<typeof ContentiaTask.fail>, catalogOk: boolean): CatalogProvider {
    const catalog = () => ContentiaTask.succeed({ collections: { posts: { type: 'document', key: 'posts' } } });
    return {
      getCatalog: catalogOk ? catalog : error,
      putCatalog: error,
      getDocumentCollectionSettings: error,
      putDocumentCollectionSettings: error,
    } as unknown as CatalogProvider;
  }

  it.each(
    [
      ['InternalError', () => new InternalError('provider down'), 500],
      ['TooManyRequestsError', () => new TooManyRequestsError('slow down'), 429],
      ['NotImplementedError', () => new NotImplementedError('read-only'), 501],
    ] as const,
  )('answers a provider %s with its own status, covered by `default`', async (_name, make, status) => {
    for (const catalogOk of [false, true]) {
      const api = buildJsonApi({ repo: failingRepo(() => ContentiaTask.fail(make()), catalogOk), authorize: allowAll });
      for (const [operationId, path, method, request] of operations) {
        // Listing only calls getCatalog, so it has nothing left to fail once that succeeds.
        if (catalogOk && operationId === 'listCollections') continue;
        const res = await api.fetch(request());
        expect(res.status, `${operationId} (catalogOk=${catalogOk})`).toBe(status);
        const responses = responsesFor(path, method);
        expect(responses[String(status)], operationId).toBeUndefined();
        expect(responses['default'], operationId).toBeDefined();
      }
    }
  });

  const throwing = (error: Error) => () =>
    ContentiaTask.make<never>(() => {
      throw error;
    });

  it('answers a thrown NetworkingError with 503 on every operation', async () => {
    const networkError = Object.assign(new Error('ECONNREFUSED internal-host:8000'), { name: 'NetworkingError' });
    const api = buildJsonApi({ repo: failingRepo(throwing(networkError), false), authorize: allowAll });
    for (const [operationId, path, method, request] of operations) {
      const res = await api.fetch(request());
      expect(res.status, operationId).toBe(503);
      expect(responsesFor(path, method)['503'], operationId).toBeDefined();
      const body = await res.json() as { errors: Array<{ code: string }> };
      expect(body.errors[0]?.code, operationId).toBe('service_unavailable');
    }
  });

  it('does not answer any other provider exception with a 400 that leaks its message', async () => {
    // Same as every other route: the shared handler rethrows it to the host.
    const api = buildJsonApi({
      repo: failingRepo(throwing(new Error('secret internal detail')), false),
      authorize: allowAll,
    });
    for (const [operationId, , , request] of operations) {
      await expect(api.fetch(request()), operationId).rejects.toThrow('secret internal detail');
    }
  });
});
