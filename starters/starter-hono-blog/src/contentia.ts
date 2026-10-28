import { resolve } from 'node:path';

import { createEmbeddedContentia } from '@contentia/server/embedded';

import { blogCollections } from './decap-config.js';

/**
 * Singleton EmbeddedContentia instance.
 *
 * createEmbeddedContentia:
 *   - Roots a FileSystemStorageRepository at `contentDir`
 *   - Writes/reads the Decap config YAML so server and editor always agree
 *   - Wires up CatalogDocumentsRepository + CatalogAssetsRepository
 *   - Returns a fetch handler for the Decap JSON:API + auth endpoints
 *
 * Import `contentia.documents` anywhere in SSR routes to read content without
 * going back through HTTP — use `runTask` / `collectStream` from contentia/compat.
 */
export const contentia = createEmbeddedContentia({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_root: '/api/decap' },
    media_folder: 'uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
