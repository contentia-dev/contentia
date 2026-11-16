import type { AssetsRepository } from 'contentia/assets';
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiPathItem,
  OpenApiRef,
  OpenApiResponse,
  OpenApiSchema,
} from 'contentia/json-api';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import { buildAssetsOpenApi } from './openapi.js';
import { buildAssetsApi } from './server.js';

const stubRepo = {} as AssetsRepository;

const METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const operationsOf = (item: OpenApiPathItem): OpenApiOperation[] =>
  METHODS
    .map(method => item[method])
    .filter((op): op is OpenApiOperation => op !== undefined);

/** Every `[path, method, operation]` in the document. */
const operationEntries = (doc: OpenApiDocument): Array<[string, string, OpenApiOperation]> =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.flatMap(method => item[method] ? [[path, method, item[method]!] as [string, string, OpenApiOperation]] : [])
  );

/** A response's description after `$ref` resolution (a ref's own description overrides the target's). */
const responseDescription = (doc: OpenApiDocument, response: OpenApiResponse | OpenApiRef): string | undefined => {
  if (!('$ref' in response)) return response.description;
  if (response.description !== undefined) return response.description;
  return doc.components?.responses?.[response.$ref.split('/').pop()!]?.description;
};

const schemaOf = (doc: OpenApiDocument, name: string): OpenApiSchema => doc.components!.schemas![name]!;
const propertiesOf = (schema: OpenApiSchema): Record<string, OpenApiSchema> =>
  schema['properties'] as Record<string, OpenApiSchema>;

describe('GET /openapi.json', () => {
  it('returns 200 with Content-Type application/json', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Assets API');
  });

  it('servers[0].url reflects the request origin + basePath', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/assets');
  });

  it('paths are exactly the routes the server implements', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/',
      '/capabilities',
      '/changes',
      '/openapi.json',
      '/openapi.yaml',
      '/operations',
      '/resources',
      '/resources/{key}',
      '/sync-token',
    ]);
  });

  it('every operation has an operationId and a responses object', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.json'));
    const doc = await res.json() as OpenApiDocument;
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      expect(op.operationId).toBeTruthy();
      expect(op.responses).toBeTypeOf('object');
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    }
  });

  it('a custom basePath passed to buildAssetsApi is reflected in the served document', async () => {
    const api = buildAssetsApi({ repository: stubRepo, basePath: '/custom/assets', authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/custom/assets/openapi.json'));
    expect(res.status).toBe(200);
    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('http://localhost/custom/assets');
  });
});

describe('GET /', () => {
  it("reports the spec's info.version", async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets'));
    const body = await res.json() as { data: { attributes: { version: string } } };
    expect(body.data.attributes.version).toBe(buildAssetsOpenApi().info.version);
  });

  it("lists exactly the spec's other paths and methods", async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets'));
    const body = await res.json() as {
      data: { attributes: { endpoints: Array<{ path: string, methods: string[] }> } },
    };
    const listed = Object.fromEntries(body.data.attributes.endpoints.map(e => [e.path, [...e.methods].sort()]));
    const specced = Object.fromEntries(
      Object.entries(buildAssetsOpenApi().paths)
        .filter(([path]) => path !== '/')
        .map(([path, item]) => [path, METHODS.filter(m => item[m]).map(m => m.toUpperCase()).sort()]),
    );
    expect(listed).toEqual(specced);
  });

  it('is served without running the access policy', async () => {
    const authorize = vi.fn(() => false);
    const api = buildAssetsApi({ repository: stubRepo, authorize });
    const res = await api.fetch(new Request('http://localhost/api/assets'));
    expect(res.status).toBe(200);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with Content-Type application/yaml', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/assets/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/yaml');
  });

  it('serves the same document as YAML with servers[0].url rewritten', async () => {
    const api = buildAssetsApi({ repository: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/assets/openapi.yaml'));
    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Assets API');
    expect(doc.servers?.[0]?.url).toBe('https://cms.example.com/api/assets');
  });
});

describe('buildAssetsOpenApi', () => {
  it('defaults servers to the default basePath', () => {
    const doc = buildAssetsOpenApi();
    expect(doc.servers?.[0]?.url).toBe('/api/assets');
  });

  it('describes the required access policy rather than an open handler', () => {
    const doc = buildAssetsOpenApi();
    expect(doc.info.description).toContain('requires an access policy (`authorize`)');
    expect(doc.info.description).toContain('authenticates no one itself');
    expect(doc.info.description).not.toContain('no authentication');
  });

  it('declares a 403 on every operation the access policy guards, and none on GET /', () => {
    const doc = buildAssetsOpenApi();
    for (const [path, method, op] of operationEntries(doc)) {
      const forbidden = op.responses['403'];
      if (path === '/') {
        expect(forbidden, `${method.toUpperCase()} ${path}`).toBeUndefined();
        continue;
      }
      expect(forbidden, `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(responseDescription(doc, forbidden!)).toBe('The access policy denied this action.');
    }
  });

  it('POST /operations says one denial rejects the whole batch before any write', () => {
    const op = buildAssetsOpenApi().paths['/operations']!.post!;
    expect(op.description).toContain('one denial rejects the whole batch with 403 before any write');
  });

  it('POST /operations says a remove of a missing target fails with 404 and ends the batch', () => {
    const doc = buildAssetsOpenApi();
    expect(doc.paths['/operations']!.post!.description).toContain(
      'a `remove` whose target does not exist fails with status 404',
    );
    const results = propertiesOf(schemaOf(doc, 'OperationsResponse'))['results']!;
    expect(results.description).toContain('ends the batch');
    expect(results.description).toContain('A `remove` whose target does not exist fails this way, with status 404');
  });

  it('declares GET / as the api-info resource with the assets id', () => {
    const doc = buildAssetsOpenApi();
    const op = doc.paths['/']!.get!;
    expect(op.operationId).toBe('getApiInfo');
    const resource = schemaOf(doc, 'ApiInfoResource');
    expect(propertiesOf(resource)['type']).toEqual({ const: 'api-info' });
    expect(propertiesOf(resource)['id']).toEqual({ const: 'assets' });
  });

  it('AssetAttributes declares the optional version token', () => {
    const attributes = schemaOf(buildAssetsOpenApi(), 'AssetAttributes');
    expect(propertiesOf(attributes)['version']).toMatchObject({ type: 'string' });
    expect(attributes['required']).not.toContain('version');
  });

  it('a folder needs attributes on POST /resources but not in a POST /operations add', () => {
    const doc = buildAssetsOpenApi();
    expect(schemaOf(doc, 'FolderCreateData')['required']).toEqual(['type', 'id', 'attributes']);
    expect(schemaOf(doc, 'OperationFolderCreateData')['required']).toEqual(['type', 'id']);
    expect(propertiesOf(schemaOf(doc, 'AddFolderOperation'))['data']).toEqual({
      $ref: '#/components/schemas/OperationFolderCreateData',
    });
  });

  it('POST /resources accepts application/json as well as application/vnd.api+json', () => {
    const body = buildAssetsOpenApi().paths['/resources']!.post!.requestBody as {
      description: string,
      content: Record<string, unknown>,
    };
    expect(Object.keys(body.content).sort()).toEqual([
      'application/json',
      'application/vnd.api+json',
      'multipart/form-data',
    ]);
    expect(body.content['application/json']).toEqual(body.content['application/vnd.api+json']);
    expect(body.description).toContain('application/vnd.api+json or application/json');
  });

  it('describes every cacheControl field as a Cache-Control header value', () => {
    const doc = buildAssetsOpenApi();
    const multipart = (doc.paths['/resources']!.post!.requestBody as {
      content: Record<string, { schema: OpenApiSchema }>,
    }).content['multipart/form-data']!.schema;
    const fields = [
      propertiesOf(propertiesOf(schemaOf(doc, 'AssetCreateData'))['attributes']!)['cacheControl'],
      propertiesOf(propertiesOf(schemaOf(doc, 'AssetUpdateData'))['attributes']!)['cacheControl'],
      propertiesOf(propertiesOf(schemaOf(doc, 'OperationAssetUpdateData'))['attributes']!)['cacheControl'],
      propertiesOf(multipart)['cacheControl'],
    ];
    for (const field of fields) expect(field?.description).toContain('`Cache-Control` header value');
  });

  it('GET /resources documents the page sizes the handler uses: 10 with no page[*] key, 100 when unsized', () => {
    const doc = buildAssetsOpenApi();
    const params = doc.paths['/resources']!.get!.parameters!.map(p =>
      '$ref' in p ? doc.components!.parameters![p.$ref.split('/').pop()!]! : p
    );
    const description = (name: string) => params.find(p => p.name === name)?.description;
    expect(description('page[size]')).toContain('With no page[*] parameter at all a page holds 10 items');
    expect(description('page[size]')).toContain('comes without page[size], a page holds 100 items');
    expect(description('page[offset]')).toContain('Without page[limit], 100 items are returned');
  });

  it('DELETE /resources/{key} explains the 200-with-warnings answer', () => {
    const op = buildAssetsOpenApi().paths['/resources/{key}']!.delete!;
    expect(op.description).toContain('answers 200 with them in `meta.warnings`');
    expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['200', '204']));
  });

  it('GET /changes ties filter[folder] to the scope of the sync token', () => {
    const op = buildAssetsOpenApi().paths['/changes']!.get!;
    const folder = op.parameters!.find(p => 'name' in p && p.name === 'filter[folder]') as { description: string };
    expect(folder.description).toContain('must match the `filter[folder]` the token was obtained with');
  });

  it('compatibilityDate is a YYYY-MM-DD date', () => {
    const capabilities = schemaOf(buildAssetsOpenApi(), 'CapabilitiesResource');
    const attributes = propertiesOf(capabilities)['attributes']!;
    expect(propertiesOf(attributes)['compatibilityDate']).toMatchObject({ type: 'string', format: 'date' });
  });

  it('POST /resources declares an explicit 409 for duplicate-key conflict (LCMS-461)', () => {
    const doc = buildAssetsOpenApi();
    const paths = doc.paths as Record<string, OpenApiPathItem>;
    expect(Object.keys(paths['/resources']!.post!.responses)).toContain('409');
  });

  it('PATCH /resources/{key} declares a 404 for a missing asset (LCMS-435)', () => {
    const doc = buildAssetsOpenApi();
    const paths = doc.paths as Record<string, OpenApiPathItem>;
    expect(Object.keys(paths['/resources/{key}']!.patch!.responses)).toContain('404');
  });
});
