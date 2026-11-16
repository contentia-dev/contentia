/**
 * The Contentia instance behind the API reference's "Try it" requests: the four JSON:API servers,
 * each mounted under its name as the reference's server URLs expect, over one
 * `WebStorageRepository` on `sessionStorage`. They share the store the way a real deployment's
 * APIs share one backend, so a document created through the Documents API shows up in a Storage
 * API listing. Loaded only by `api-sandbox.ts`, on the first request.
 */
import { buildAssetsApi } from 'contentia/assets-api';
import { CatalogAssetsRepository } from 'contentia/assets/catalog';
import { buildJsonApi as buildCatalogApi } from 'contentia/catalog-api';
import { ConventionCatalogProvider } from 'contentia/catalog-convention';
import { buildJsonApi as buildDocumentsApi } from 'contentia/documents-api';
import { CatalogDocumentsRepository } from 'contentia/documents/catalog';
import { allowAll } from 'contentia/json-api';
import { jsonSerializer } from 'contentia/serializers/json';
import { markdownSerializer } from 'contentia/serializers/markdown';
import { yamlSerializer } from 'contentia/serializers/yaml';
import { buildJsonApi as buildStorageApi } from 'contentia/storage-api';
import { WebStorageRepository } from 'contentia/storage/web';

import { EXAMPLE_SERVER } from '../../reference/examples/example-server';
import { SANDBOX_SEED } from '../../reference/examples/sandbox-seed';
import { NAMESPACE } from './api-sandbox';

export interface SandboxApi {
  fetch(request: Request): Promise<Response>;
}

/** Put the seed's content in through `apis`, in order. Throws at the first request that fails. */
export async function seedSandbox(apis: Readonly<Record<string, SandboxApi>>): Promise<void> {
  for (const { api, path, body } of SANDBOX_SEED) {
    const response = await apis[api]!.fetch(
      new Request(`${EXAMPLE_SERVER}/${api}${path}`, {
        method: 'POST',
        headers: { 'Accept': 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      throw new Error(`Seeding the sandbox: POST /${api}${path} returned ${response.status}: ${await response.text()}`);
    }
  }
}

export function createSandboxApis(): Readonly<Record<string, SandboxApi>> {
  const storage = new WebStorageRepository({
    storage: sessionStorage,
    serializerRegistry: { json: jsonSerializer, md: markdownSerializer, yaml: yamlSerializer },
    defaultExtension: 'json',
    namespace: NAMESPACE,
  });
  const catalog = new ConventionCatalogProvider({ storage });
  // Anyone may do anything: the only data at stake is the reader's own, in their own tab.
  return {
    storage: buildStorageApi({ repo: storage, basePath: '/storage', authorize: allowAll }),
    documents: buildDocumentsApi({
      repo: new CatalogDocumentsRepository(storage, catalog),
      basePath: '/documents',
      authorize: allowAll,
    }),
    assets: buildAssetsApi({
      repository: new CatalogAssetsRepository(storage, catalog),
      basePath: '/assets',
      authorize: allowAll,
    }),
    catalog: buildCatalogApi({ repo: catalog, basePath: '/catalog', authorize: allowAll }),
  };
}
