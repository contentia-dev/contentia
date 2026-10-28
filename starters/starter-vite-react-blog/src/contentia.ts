import { resolve } from 'node:path';

import { createEmbeddedContentia } from '@contentia/server/embedded';

import { blogCollections } from './decap-config.js';

export const contentia = createEmbeddedContentia({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_root: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});
