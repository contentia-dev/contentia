import type { DocumentsRepository } from 'contentia/documents';
import type { OpenApiDocument, OpenApiOperation, OpenApiPathItem } from 'contentia/json-api';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import { buildDocumentsOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// The openapi.json route never touches the repository, so an empty stub suffices.
const stubRepo = {} as DocumentsRepository;

// Exactly the routes implemented by buildJsonApi's fetchInner (plus /openapi.json itself).
const expectedPaths = [
  '/',
  '/openapi.json',
  '/openapi.yaml',
  '/capabilities',
  '/sync-token',
  '/changes',
  '/records',
  '/record-summaries',
  '/published',
  '/published/{key}',
  '/published/{key}/unpublish',
  '/unpublished',
  '/unpublished/{key}',
  '/unpublished/{key}/publish',
  '/revisions',
  '/revisions/{key}',
  '/revisions/{key}/{revisionId}',
  '/operations',
];

const httpMethods = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const operationsOf = (pathItem: OpenApiPathItem): OpenApiOperation[] =>
  httpMethods.flatMap(method => pathItem[method] ? [pathItem[method]!] : []);

describe('GET /openapi.json', () => {
  it('returns 200 with Content-Type application/json', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serves an OpenAPI 3.1.0 document with the expected info fields', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Documents API');
    expect(doc.info.version).toBe('1.0.1');
    expect(doc.info.license).toEqual({ name: 'MIT', identifier: 'MIT' });
    expect(doc.info.description).toContain('JSON:API');
    expect(doc.info.description).toContain('no built-in authentication');
  });

  it('rewrites servers[0].url to the request origin plus basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(doc.servers).toHaveLength(1);
    expect(doc.servers![0]!.url).toBe('http://localhost');
  });

  it('documents exactly the implemented routes', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });

  it('gives every operation an operationId and at least one response', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    const doc = await res.json() as OpenApiDocument;

    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThanOrEqual(expectedPaths.length);
    for (const op of operations) {
      expect(op.operationId).toBeTruthy();
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    }

    const operationIds = operations.map(op => op.operationId);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('reflects a custom basePath in the served document', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/documents', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/documents/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers![0]!.url).toBe('https://cms.example.com/api/documents');
    // Path keys stay relative to the basePath.
    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with Content-Type application/yaml', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/yaml');
  });

  it('serves the same document as YAML with servers[0].url rewritten', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/documents', authorize: allowAll });
    const res = await api.fetch(new Request('https://cms.example.com/api/documents/openapi.yaml'));
    const doc = load(await res.text()) as OpenApiDocument;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Documents API');
    expect(doc.servers![0]!.url).toBe('https://cms.example.com/api/documents');
    expect(Object.keys(doc.paths).sort()).toEqual([...expectedPaths].sort());
  });
});

describe('buildDocumentsOpenApi', () => {
  it('defaults servers[0].url to "/" for the default (empty) basePath', () => {
    const doc = buildDocumentsOpenApi();
    expect(doc.servers![0]!.url).toBe('/');
  });

  it('uses the given basePath as the server url', () => {
    const doc = buildDocumentsOpenApi({ basePath: '/api/documents' });
    expect(doc.servers![0]!.url).toBe('/api/documents');
  });

  it('only references component schemas that exist', () => {
    const doc = buildDocumentsOpenApi();
    const defined = new Set(Object.keys(doc.components!.schemas!));
    const referenced = JSON.stringify(doc).match(/#\/components\/schemas\/([A-Za-z0-9]+)/g) ?? [];
    for (const r of referenced) {
      expect(defined).toContain(r.replace('#/components/schemas/', ''));
    }
  });

  // The `data` member of a write request is a $ref to a shared `*WriteData`
  // component, so the requirement lives one hop away from the request schema.
  const requiredOfWriteData = (doc: OpenApiDocument, requestName: string): string[] => {
    const schemas = doc.components!.schemas! as Record<
      string,
      { required?: string[], properties?: { data?: { $ref?: string, required?: string[] } } }
    >;
    const data = schemas[requestName]!.properties!.data!;
    const target = data.$ref ? schemas[data.$ref.replace('#/components/schemas/', '')]! : data;
    return target.required ?? [];
  };

  it('PublishedCreateRequest requires data.id (LCMS-397)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'PublishedCreateRequest')).toContain('id');
  });

  it('UnpublishedCreateRequest requires data.id (LCMS-397)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'UnpublishedCreateRequest')).toContain('id');
  });

  it('RevisionCreateRequest requires data.id (LCMS-398)', () => {
    expect(requiredOfWriteData(buildDocumentsOpenApi(), 'RevisionCreateRequest')).toContain('id');
  });

  it('POST create endpoints declare 409 for duplicate-key conflict (LCMS-287)', () => {
    const doc = buildDocumentsOpenApi();
    const paths = doc.paths as Record<string, { post?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/published']!.post!.responses)).toContain('409');
    expect(Object.keys(paths['/unpublished']!.post!.responses)).toContain('409');
    expect(Object.keys(paths['/revisions']!.post!.responses)).toContain('409');
  });

  it('DELETE /unpublished/{key} declares 404 for missing draft (LCMS-287)', () => {
    const doc = buildDocumentsOpenApi();
    const paths = doc.paths as Record<string, { delete?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/unpublished/{key}']!.delete!.responses)).toContain('404');
  });
});

describe('buildDocumentsOpenApi — matches the handler', () => {
  const doc = buildDocumentsOpenApi();
  const schemas = doc.components!.schemas! as Record<string, Record<string, unknown>>;
  const paths = doc.paths as Record<string, OpenApiPathItem>;
  const schema = (name: string) =>
    schemas[name] as {
      required?: string[],
      properties?: Record<string, Record<string, unknown>>,
      allOf?: Array<{ required?: string[], properties?: Record<string, unknown> }>,
    };
  /** A response's effective description: a `$ref`'s own description overrides the component's. */
  const descriptionOf = (response: unknown): string | undefined => {
    const r = response as { $ref?: string, description?: string };
    if (r.description !== undefined || !r.$ref) return r.description;
    return doc.components!.responses![r.$ref.replace('#/components/responses/', '')]!.description;
  };
  const responsesOf = (path: string, method: (typeof httpMethods)[number]) => paths[path]![method]!.responses;
  const writeAttributes = (dataSchema: string) =>
    schema(dataSchema).properties!['attributes'] as {
      required?: string[],
      properties: Record<string, { description?: string }>,
    };

  it('declares 403 on every authorized operation, and not on GET /', () => {
    for (const [path, item] of Object.entries(paths)) {
      for (const method of httpMethods) {
        const operation = item[method];
        if (!operation) continue;
        const forbidden = operation.responses['403'];
        if (path === '/' && method === 'get') {
          expect(forbidden).toBeUndefined();
          continue;
        }
        expect(forbidden, `${method.toUpperCase()} ${path}`).toBeDefined();
        expect(descriptionOf(forbidden)).toBe('The access policy denied this action.');
      }
    }
  });

  it('says a batch is authorized whole before any write', () => {
    expect(paths['/operations']!.post!.description).toContain('one denial fails the whole batch with 403');
  });

  it('keeps `type` out of every response attribute schema', () => {
    for (
      const name of [
        'PublishedResource',
        'PublishedSummaryResource',
        'UnpublishedResource',
        'UnpublishedSummaryResource',
        'RevisionResource',
        'RevisionSummaryResource',
      ]
    ) {
      const attributes = schema(name).properties!['attributes'] as {
        allOf: Array<{ required?: string[], properties?: Record<string, unknown> }>,
      };
      for (const part of attributes.allOf) {
        expect(part.required ?? [], name).not.toContain('type');
        expect(Object.keys(part.properties ?? {}), name).not.toContain('type');
      }
    }
  });

  it('declares the optional version on published and unpublished records, full and summary', () => {
    const ownAttributes = (name: string) =>
      (schema(name).properties!['attributes'] as {
        allOf: Array<{ required?: string[], properties?: Record<string, { type?: string }> }>,
      }).allOf[1]!;
    for (
      const name of [
        'PublishedResource',
        'PublishedSummaryResource',
        'UnpublishedResource',
        'UnpublishedSummaryResource',
      ]
    ) {
      expect(ownAttributes(name).properties!['version'], name).toMatchObject({ type: 'string' });
      expect(ownAttributes(name).required, name).not.toContain('version');
    }
    for (const name of ['RevisionResource', 'RevisionSummaryResource']) {
      expect(ownAttributes(name).properties!['version'], name).toBeUndefined();
    }
  });

  it('describes the composite revision id and the key attribute', () => {
    for (const name of ['RevisionResource', 'RevisionSummaryResource']) {
      expect(schema(name).properties!['id']!['description']).toContain('{key}/{revision}');
      const own = (schema(name).properties!['attributes'] as { allOf: Array<{ required?: string[] }> }).allOf[1]!;
      expect(own.required).toContain('key');
    }
  });

  it('maps DELETE /published/{key} not-found to 404', () => {
    expect(descriptionOf(responsesOf('/published/{key}', 'delete')['404'])).toBe('Document not found.');
  });

  it('declares 409 on both PATCH routes for a body id that differs from the URL key', () => {
    for (const path of ['/published/{key}', '/unpublished/{key}']) {
      expect(descriptionOf(responsesOf(path, 'patch')['409'])).toContain('`data.id`');
    }
  });

  it('offers only document and unpublished as batch refs', () => {
    expect(schema('ResourceRef').properties!['type']!['enum']).toEqual(['document', 'unpublished']);
  });

  it('declares no page[*] parameters on GET /changes, whose feed is not paginated', () => {
    const names = (paths['/changes']!.get!.parameters ?? []).map(p => JSON.stringify(p));
    // Compaction may turn a parameter into a `$ref` such as `#/components/parameters/PageNumber`.
    expect(names.some(n => /page/i.test(n))).toBe(false);
    expect(names.length).toBe(2);
    expect(paths['/changes']!.get!.description).toContain('one `change-summary` per changed key');
  });

  it('lets record listings return folder entries', () => {
    const items = (name: string) => JSON.stringify((schema(name).properties!['data'] as { items: unknown }).items);
    expect(items('RecordsCollectionResponse')).toContain('FolderResource');
    expect(items('RecordSummariesCollectionResponse')).toContain('FolderSummaryResource');
  });

  it('requires status on an unpublished create and revision on a revision create', () => {
    expect(writeAttributes('UnpublishedCreateData').required).toEqual(['status']);
    expect(writeAttributes('UnpublishedUpdateData').required).toBeUndefined();
    expect(writeAttributes('RevisionWriteData').required).toEqual(['revision']);
    expect(JSON.stringify(schema('AddUnpublishedOperation'))).toContain('UnpublishedCreateData');
    expect(JSON.stringify(schema('UpdateUnpublishedOperation'))).toContain('UnpublishedUpdateData');
  });

  it('documents the `und` language default on every create', () => {
    for (const name of ['PublishedWriteData', 'UnpublishedCreateData', 'RevisionWriteData']) {
      expect(writeAttributes(name).properties['language']!.description).toContain('`und`');
    }
  });

  it('says DELETE /unpublished/{key} is permanent', () => {
    expect(paths['/unpublished/{key}']!.delete!.description).toContain('permanently');
  });

  it('describes batch error entries exactly, code included', () => {
    expect(schema('AtomicResultError').required).toEqual(['status', 'code', 'title', 'detail']);
    expect(schema('AtomicResultError').properties!['title']).toEqual({ const: 'Operation Failed' });
  });

  it('types compatibilityDate as a date', () => {
    const attributes = schema('CapabilitiesResource').properties!['attributes'] as {
      properties: Record<string, Record<string, unknown>>,
    };
    expect(attributes.properties['compatibilityDate']).toMatchObject({ type: 'string', format: 'date' });
  });
});
