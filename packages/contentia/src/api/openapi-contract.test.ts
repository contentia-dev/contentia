import type { OpenApiDocument, OpenApiOperation, OpenApiRef, OpenApiResponse, OpenApiSchema } from 'contentia/json-api';
import { JSON_API_MEDIA_TYPE } from 'contentia/json-api';
import { describe, expect, it } from 'vitest';

import { buildAssetsOpenApi } from './assets-api/openapi.js';
import { buildCatalogOpenApi } from './catalog-api/openapi.js';
import { buildDocumentsOpenApi } from './documents-api/openapi.js';
import { buildStorageOpenApi } from './storage-api/openapi.js';

/**
 * Invariants every `api/*` OpenAPI document must satisfy, checked in one place
 * so a new surface (or a change to the shared component vocabulary in
 * `contentia/json-api`) cannot satisfy them for three specs and quietly break
 * the fourth.
 */

const documents: Array<[name: string, doc: OpenApiDocument]> = [
  ['documents', buildDocumentsOpenApi()],
  ['storage', buildStorageOpenApi()],
  ['assets', buildAssetsOpenApi()],
  ['catalog', buildCatalogOpenApi()],
];

const refsInto = (doc: OpenApiDocument, section: string): string[] => {
  const pattern = new RegExp(`"#/components/${section}/([^"]+)"`, 'g');
  return [...JSON.stringify(doc).matchAll(pattern)].map(match => match[1]!);
};

const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete', 'head', 'options'] as const;

/** Every operation in the document, keyed `METHOD /path`. */
const operationsOf = (doc: OpenApiDocument): Array<[route: string, operation: OpenApiOperation]> =>
  Object.entries(doc.paths).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap(method => {
      const operation = item[method];
      return operation ? [[`${method.toUpperCase()} ${path}`, operation] as [string, OpenApiOperation]] : [];
    })
  );

/**
 * The response an operation declares for `code`, with a `$ref` into
 * `components.responses` followed. `compactOpenApiDocument` turns an inline
 * error body into `{ $ref: '#/components/responses/ErrorResponse', description }`,
 * so a check against the resolved body holds for both forms.
 */
const responseOf = (doc: OpenApiDocument, operation: OpenApiOperation, code: string): OpenApiResponse | undefined => {
  const response: OpenApiResponse | OpenApiRef | undefined = operation.responses[code];
  if (response === undefined || !('$ref' in response)) return response;
  return doc.components?.responses?.[response.$ref.replace('#/components/responses/', '')];
};

describe.each(documents)('%s OpenAPI document', (_name, doc) => {
  it.each(['schemas', 'responses', 'parameters'])('resolves every $ref into components.%s', section => {
    const declared = new Set(
      Object.keys((doc.components as Record<string, Record<string, unknown>> | undefined)?.[section] ?? {}),
    );
    for (const name of refsInto(doc, section)) {
      expect(declared, `dangling #/components/${section}/${name}`).toContain(name);
    }
  });

  it('declares no component schema nothing references', () => {
    const referenced = new Set(refsInto(doc, 'schemas'));
    const orphans = Object.keys(doc.components?.schemas ?? {}).filter(name => !referenced.has(name));
    expect(orphans).toEqual([]);
  });

  it('folds repeated response bodies into components rather than inlining them', () => {
    // `compactOpenApiDocument` hoists any body used more than once, so no two
    // operations may still carry the same inline body.
    const bodies = Object.values(doc.paths)
      .flatMap(item => [item.get, item.put, item.post, item.patch, item.delete])
      .flatMap(operation => Object.values(operation?.responses ?? {}))
      .flatMap(response => '$ref' in response ? [] : [JSON.stringify({ ...response, description: undefined })])
      .filter(body => body !== JSON.stringify({ description: undefined }));

    expect(new Set(bodies).size).toBe(bodies.length);
  });

  it('declares the access-policy 403 on every operation except GET /', () => {
    // Each handler runs `authorize` before every action but the `GET /`
    // endpoint listing, and a denial answers with a JSON:API error document.
    const undeclared = operationsOf(doc)
      .filter(([route]) => route !== 'GET /')
      .filter(([, operation]) =>
        responseOf(doc, operation, '403')?.content?.[JSON_API_MEDIA_TYPE]?.schema?.['$ref']
          !== '#/components/schemas/JsonApiError'
      )
      .map(([route]) => route);

    expect(undeclared).toEqual([]);
  });
});

describe('shared JSON:API vocabulary', () => {
  const schemaOf = (doc: OpenApiDocument, name: string): OpenApiSchema | undefined => doc.components?.schemas?.[name];

  it('describes the error object identically everywhere', () => {
    // Every handler funnels failures through `errorToJsonApiMapper`, so a spec
    // that disagrees about the error shape is describing a fiction.
    const shapes = documents.map(([, doc]) => JSON.stringify(schemaOf(doc, 'JsonApiErrorObject')));
    expect(shapes.every(shape => shape !== undefined && shape === shapes[0])).toBe(true);
  });

  it('requires all four members the error mapper always emits', () => {
    const [, doc] = documents[0]!;
    expect((schemaOf(doc, 'JsonApiErrorObject') as { required: string[] }).required)
      .toEqual(['code', 'status', 'title', 'detail']);
  });

  it('never advertises a links.last no link builder can produce', () => {
    for (const [name, doc] of documents) {
      const links = schemaOf(doc, 'PaginationLinks') as { properties?: Record<string, unknown> } | undefined;
      expect(Object.keys(links?.properties ?? {}), name).not.toContain('last');
    }
  });
});
