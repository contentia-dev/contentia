import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { allowAll } from '../../shared/json-api/authorize.js';

import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRef,
  OpenApiResponse,
  OpenApiSchema,
} from 'contentia/json-api';
import type { StorageRepository } from 'contentia/storage';

import { buildStorageOpenApi } from './openapi.js';
import { buildJsonApi } from './server.js';

// The openapi.json route never touches the repo, so a placeholder cast is enough.
const stubRepo = {} as StorageRepository;

const EXPECTED_PATHS = [
  '/',
  '/atom-summaries',
  '/atom-summaries/{key}',
  '/atom/{key}',
  '/atoms',
  '/atoms/{key}',
  '/capabilities',
  '/folders/{key}',
  '/objects',
  '/objects/{key}',
  '/openapi.json',
  '/openapi.yaml',
  '/operations',
];

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

const operationsOf = (item: OpenApiPathItem): OpenApiOperation[] =>
  HTTP_METHODS.map(method => item[method]).filter((op): op is OpenApiOperation => op !== undefined);

/** Every operation with its `METHOD /path` label. */
const labelledOperations = (doc: OpenApiDocument): Array<[label: string, operation: OpenApiOperation]> =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap(method => {
      const operation = item[method];
      return operation ? [[`${method.toUpperCase()} ${path}`, operation] as [string, OpenApiOperation]] : [];
    })
  );

/** A response's effective description, following a `$ref` (whose own description overrides the target's). */
const responseDescription = (doc: OpenApiDocument, response: OpenApiResponse | OpenApiRef | undefined) => {
  if (!response) return undefined;
  if (!('$ref' in response)) return response.description;
  return response.description ?? doc.components?.responses?.[response.$ref.split('/').pop() ?? '']?.description;
};

const schemaOf = (doc: OpenApiDocument, name: string) =>
  doc.components?.schemas?.[name] as OpenApiSchema & {
    properties?: Record<string, OpenApiSchema & { properties?: Record<string, unknown> }>,
    description?: string,
  };

describe('GET /openapi.json', () => {
  it('returns 200 with an application/json OpenAPI 3.1 document', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const doc = await res.json() as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Storage API');
  });

  it('rewrites servers[0].url to the request origin + basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('https://storage.example.com/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://storage.example.com');
  });

  it('reflects a custom basePath in the served document', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/storage', authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/api/storage/openapi.json'));
    expect(res.status).toBe(200);

    const doc = await res.json() as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('http://localhost/api/storage');
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with an application/yaml OpenAPI 3.1 document', async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/openapi.yaml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/yaml');

    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Contentia Storage API');
  });

  it('rewrites servers[0].url to the request origin + basePath', async () => {
    const api = buildJsonApi({ repo: stubRepo, basePath: '/api/storage', authorize: allowAll });
    const res = await api.fetch(new Request('https://storage.example.com/api/storage/openapi.yaml'));
    expect(res.status).toBe(200);

    const doc = load(await res.text()) as OpenApiDocument;
    expect(doc.servers?.[0]?.url).toBe('https://storage.example.com/api/storage');
  });
});

describe('buildStorageOpenApi', () => {
  it('documents exactly the implemented routes', () => {
    const doc = buildStorageOpenApi();
    expect(Object.keys(doc.paths).sort()).toEqual(EXPECTED_PATHS);
  });

  it('gives every operation an operationId, summary, tags, and responses', () => {
    const doc = buildStorageOpenApi();
    const operations = Object.values(doc.paths).flatMap(operationsOf);
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.operationId).toBeDefined();
      expect(operation.summary).toBeDefined();
      expect(operation.tags?.length).toBeGreaterThan(0);
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
    }
  });

  it('assigns a unique operationId to every operation', () => {
    const doc = buildStorageOpenApi();
    const ids = Object.values(doc.paths).flatMap(operationsOf).map(op => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('documents every {key} path with a required path parameter', () => {
    const doc = buildStorageOpenApi();
    // Repeated parameters are hoisted into components by compactOpenApiDocument,
    // so resolve `$ref`s before looking for the declaration.
    const deref = (parameter: OpenApiParameter | OpenApiRef): OpenApiParameter | undefined =>
      '$ref' in parameter
        ? doc.components?.parameters?.[parameter.$ref.split('/').pop() ?? '']
        : parameter;
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!path.includes('{key}')) continue;
      const keyParam = item.parameters?.map(deref).find(p => p?.name === 'key' && p.in === 'path');
      expect(keyParam, `missing key path parameter on ${path}`).toBeDefined();
      expect(keyParam?.required).toBe(true);
    }
  });

  it('uses the basePath as the static server url', () => {
    expect(buildStorageOpenApi({ basePath: '/api/storage' }).servers?.[0]?.url).toBe(
      '/api/storage',
    );
    expect(buildStorageOpenApi().servers?.[0]?.url).toBe('/');
  });

  it('POST /objects declares an explicit 409 for duplicate-key conflict (LCMS-287)', () => {
    const doc = buildStorageOpenApi();
    const paths = doc.paths as Record<string, { post?: { responses: Record<string, unknown> } }>;
    expect(Object.keys(paths['/objects']!.post!.responses)).toContain('409');
  });

  it('declares a 403 on every operation the access policy guards, which is all but GET /', () => {
    const doc = buildStorageOpenApi();
    for (const [label, operation] of labelledOperations(doc)) {
      const forbidden = responseDescription(doc, operation.responses['403']);
      if (label === 'GET /') expect(forbidden, label).toBeUndefined();
      else expect(forbidden, label).toBe('The access policy denied this action.');
    }
  });

  it('documents GET /atom/{key}: an object or a folder, 404 when the key is neither', () => {
    const doc = buildStorageOpenApi();
    const operation = doc.paths['/atom/{key}']?.get;
    expect(operation?.operationId).toBe('getAtom');
    expect(Object.keys(operation?.responses ?? {})).toEqual(expect.arrayContaining(['200', '400', '403', '404']));
    const data = schemaOf(doc, 'AtomResponse').properties?.['data'];
    expect(data).toEqual({ $ref: '#/components/schemas/AtomResource' });
  });

  it('documents the 400 for path segments after the key on every keyed operation', () => {
    const doc = buildStorageOpenApi();
    for (const [label, operation] of labelledOperations(doc)) {
      if (!label.includes('{key}')) continue;
      expect(responseDescription(doc, operation.responses['400']), label).toContain('%2F');
    }
  });

  it('leaves `type` out of response attributes, which the handler strips', () => {
    const doc = buildStorageOpenApi();
    const attributeSchemas = [
      schemaOf(doc, 'StorageObjectAttributes'),
      schemaOf(doc, 'FolderAttributes'),
      schemaOf(doc, 'StorageObjectSummaryResource').properties?.['attributes'],
      schemaOf(doc, 'FolderSummaryResource').properties?.['attributes'],
    ];
    for (const schema of attributeSchemas) {
      expect(Object.keys(schema?.properties ?? {})).not.toContain('type');
      expect(schema?.required ?? []).not.toContain('type');
    }
  });

  it('describes compatibilityDate as a YYYY-MM-DD contract version', () => {
    const doc = buildStorageOpenApi();
    expect(schemaOf(doc, 'Capabilities').properties?.['compatibilityDate']).toEqual({
      type: 'string',
      format: 'date',
      description: 'The repository contract version the backend implements, as YYYY-MM-DD. It changes when the '
        + 'repository contract changes, so a client can compare it to detect an incompatible backend.',
    });
  });

  it('states the exact Allow header that /objects/{key} sends with a 405', () => {
    expect(buildStorageOpenApi().paths['/objects/{key}']?.description).toContain('`Allow: GET, PATCH, DELETE`');
  });

  it('says content defaults to {} on create', () => {
    const create = schemaOf(buildStorageOpenApi(), 'StorageObjectCreateData');
    const attributes = create.properties?.['attributes'] as { properties: Record<string, { description?: string }> };
    expect(attributes.properties['content']?.description).toContain('Defaults to `{}`');
  });

  it('pins the removed ref type to `atom`, the only type the handler reports', () => {
    const removeResult = schemaOf(buildStorageOpenApi(), 'AtomicRemoveResult');
    const meta = removeResult.properties?.['meta'] as {
      properties: { ref: { properties: { type: unknown } } },
    };
    expect(meta.properties.ref.properties.type).toEqual({ const: 'atom' });
  });

  it('documents that a failed remove keeps its slot and a failed add or update is omitted', () => {
    const doc = buildStorageOpenApi();
    const operation = doc.paths['/operations']?.post;
    for (const text of [schemaOf(doc, 'AtomicResultsResponse').description, operation?.description]) {
      expect(text).toContain('failed remove keeps its slot');
      expect(text).toMatch(/failed add or update is omitted/i);
    }
    expect(operation?.description).toContain('concurrently');
  });
});

describe('GET /', () => {
  it("reports the spec's info.version", async () => {
    const api = buildJsonApi({ repo: stubRepo, authorize: allowAll });
    const res = await api.fetch(new Request('http://localhost/'));
    const body = await res.json() as { data: { attributes: { version: string } } };
    expect(body.data.attributes.version).toBe(buildStorageOpenApi().info.version);
  });
});
