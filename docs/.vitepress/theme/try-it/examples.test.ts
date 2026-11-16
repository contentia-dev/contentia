/**
 * Every endpoint's Try it works: for each operation in each API's spec, the request its window
 * starts with succeeds when it's the first one sent to a freshly seeded sandbox, the same
 * Contentia instance the reference pages run in the browser, here over an in-memory
 * `sessionStorage`. The exception is the change feed, which the sandbox's backend doesn't have:
 * those endpoints answer 501, as the API does for any backend without it.
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
import { createSandboxApis, type SandboxApi, seedSandbox } from '../api-sandbox-apis';
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

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

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

const operationIds = (spec: Spec) =>
  Object.values(spec.paths).flatMap(item =>
    METHODS.flatMap(method => {
      const id = (item[method] as { operationId?: string } | undefined)?.operationId;
      return id ? [id] : [];
    })
  );

/**
 * Send what `operationId`'s window starts with, as its Send button would. A required parameter
 * the window leaves for the reader to fill in gets a placeholder value.
 */
async function send(api: SandboxApi, spec: Spec, operationId: string) {
  const operation = findOperation(spec, operationId)!;
  const values = Object.fromEntries(
    operation.params.map(param => [`${param.in}:${param.name}`, param.initial || (param.required ? 'x' : '')]),
  );
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

/**
 * The change feed: the sandbox's catalog repositories sit on a `WebStorageRepository`, which keeps
 * none, so these say so with a 501.
 */
const CHANGE_FEED = new Set(['getSyncToken', 'listChanges']);

const APIS = [
  { api: 'storage', spec: forTryIt(buildStorageOpenApi(), 'storage', storageHttp) },
  { api: 'documents', spec: forTryIt(buildDocumentsOpenApi(), 'documents', documentsHttp) },
  { api: 'assets', spec: forTryIt(buildAssetsOpenApi(), 'assets', assetsHttp) },
  { api: 'catalog', spec: forTryIt(buildCatalogOpenApi(), 'catalog', catalogHttp) },
];

let apis: Readonly<Record<string, SandboxApi>>;

async function freshSandbox() {
  (globalThis as { sessionStorage?: Storage }).sessionStorage = new MemoryStorage();
  apis = createSandboxApis();
  await seedSandbox(apis);
}

describe('the sandbox seed', () => {
  it('applies to an empty store', async () => {
    await expect(freshSandbox()).resolves.toBeUndefined();
  });

  it('is there to read', async () => {
    await freshSandbox();
    const records = JSON.parse((await send(apis.documents!, APIS[1]!.spec, 'listRecords')).body);
    expect(records.data.map((record: { id: string }) => record.id).sort()).toEqual([
      'posts/hello-world',
      'posts/second-post',
    ]);
  });
});

describe.each(APIS)('$api', ({ api, spec }) => {
  beforeEach(freshSandbox);

  const ids = operationIds(spec);

  it.each(ids.filter(id => !CHANGE_FEED.has(id)))('%s succeeds first thing', async operationId => {
    const { status, body } = await send(apis[api]!, spec, operationId);
    expect(status, body).toBeGreaterThanOrEqual(200);
    expect(status, body).toBeLessThan(300);
  });

  it.runIf(ids.some(id => CHANGE_FEED.has(id)))('has no change feed, and says so', async () => {
    const capabilities = JSON.parse((await send(apis[api]!, spec, 'getCapabilities')).body);
    expect(capabilities.data.attributes.changes.supported).toBe(false);
    for (const operationId of ids.filter(id => CHANGE_FEED.has(id))) {
      const { status, body } = await send(apis[api]!, spec, operationId);
      expect(status, `${operationId}: ${body}`).toBe(501);
    }
  });
});
