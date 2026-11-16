/**
 * Every request a Try it window starts with works: each API's examples, replayed in an order a
 * reader might send them in, against the same Contentia instance the reference pages run in the
 * browser, over an in-memory `sessionStorage`.
 */
import { buildAssetsOpenApi } from 'contentia/assets-api';
import { buildCatalogOpenApi } from 'contentia/catalog-api';
import { buildDocumentsOpenApi } from 'contentia/documents-api';
import { buildStorageOpenApi } from 'contentia/storage-api';
import { beforeEach, describe, expect, it } from 'vitest';

import { assetsHttp } from '../../../reference/examples/assets/http';
import { catalogHttp } from '../../../reference/examples/catalog/http';
import { documentsHttp } from '../../../reference/examples/documents/http';
import { EXAMPLE_SERVER } from '../../../reference/examples/example-server';
import type { HttpExample } from '../../../reference/examples/http-example';
import { storageHttp } from '../../../reference/examples/storage/http';
import { createSandboxApis, type SandboxApi } from '../api-sandbox-apis';
import { buildUrl, findOperation, isJson, type Spec } from './request-model';

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

/** The spec as the reference page has it: served from the example server, examples attached. */
function forTryIt(spec: object, api: string, http: Readonly<Record<string, HttpExample>>): Spec {
  const { paths } = spec as Spec;
  return {
    ...spec,
    servers: [{ url: `${EXAMPLE_SERVER}/${api}` }],
    paths: Object.fromEntries(
      Object.entries(paths).map(([path, item]) => [
        path,
        Object.fromEntries(
          Object.entries(item).map(([method, value]) => {
            const id = (value as { operationId?: string }).operationId;
            return [method, id && http[id] ? { ...(value as object), 'x-example': http[id] } : value];
          }),
        ),
      ]),
    ),
  };
}

/** Send what `operationId`'s window starts with, as its Send button would. */
async function send(api: SandboxApi, spec: Spec, operationId: string) {
  const operation = findOperation(spec, operationId);
  if (!operation) throw new Error(`No operation ${operationId}`);
  const values = Object.fromEntries(operation.params.map(param => [`${param.in}:${param.name}`, param.initial]));
  const bodyType = operation.bodyTypes.find(type => isJson(type.mediaType))?.mediaType;
  const response = await api.fetch(
    new Request(buildUrl(operation, values), {
      method: operation.method.toUpperCase(),
      headers: { Accept: 'application/vnd.api+json', ...(bodyType && { 'Content-Type': bodyType }) },
      body: bodyType ? operation.initialBody : undefined,
    }),
  );
  return { status: response.status, body: await response.text() };
}

const APIS = [
  {
    api: 'storage',
    spec: forTryIt(buildStorageOpenApi(), 'storage', storageHttp),
    steps: [
      'createFolder',
      'createStorageObject',
      'getStorageObject',
      'getFolder',
      'listAtoms',
      'listAtomSummaries',
      'updateStorageObject',
      'deleteStorageObject',
      'runAtomicOperations',
    ],
  },
  {
    api: 'documents',
    spec: forTryIt(buildDocumentsOpenApi(), 'documents', documentsHttp),
    steps: [
      'createPublished',
      'getPublished',
      'updatePublished',
      'createRevision',
      'listRevisions',
      'getRevision',
      'createUnpublished',
      'getUnpublished',
      'updateUnpublished',
      'listRecords',
      'listRecordSummaries',
      'deleteUnpublished',
      'createUnpublished',
      'publishUnpublished',
      'postBatchOperations',
      'deletePublished',
      'createPublished',
      'unpublishPublished',
    ],
  },
  {
    api: 'catalog',
    spec: forTryIt(buildCatalogOpenApi(), 'catalog', catalogHttp),
    steps: ['createCollection', 'getCollection', 'listCollections', 'updateCollection', 'deleteCollection'],
  },
  {
    api: 'assets',
    spec: forTryIt(buildAssetsOpenApi(), 'assets', assetsHttp),
    steps: ['createResource', 'getResource', 'listResources', 'updateAsset', 'postBatchOperations', 'deleteResource'],
  },
];

describe.each(APIS)('$api examples', ({ api, spec, steps }) => {
  let apis: Readonly<Record<string, SandboxApi>>;
  beforeEach(() => {
    (globalThis as { sessionStorage?: Storage }).sessionStorage = new MemoryStorage();
    apis = createSandboxApis();
  });

  it('succeed in order', async () => {
    for (const step of steps) {
      const { status, body } = await send(apis[api]!, spec, step);
      expect(status, `${step}: ${body}`).toBeLessThan(300);
    }
  });
});
