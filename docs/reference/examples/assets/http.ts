import type { HttpExample } from '../http-example.js';
import { PIXEL_PNG } from '../sandbox-seed.js';

/**
 * The Assets API's example requests, keyed by operationId: the values its Try it windows start
 * with. They read and change the sandbox's seeded `images/pixel.png` (`../sandbox-seed.ts`), and
 * create what isn't in it.
 */
export const assetsHttp: Readonly<Record<string, HttpExample>> = {
  listResources: { query: { folder: 'images' } },
  createResource: {
    body: {
      data: {
        type: 'asset',
        id: 'images/logo.png',
        attributes: { mimeType: 'image/png', filename: 'logo.png', content: PIXEL_PNG },
      },
    },
  },
  getResource: { path: { key: 'images/pixel.png' } },
  updateAsset: {
    path: { key: 'images/pixel.png' },
    body: { data: { type: 'asset', attributes: { cacheControl: 'public, max-age=3600' } } },
  },
  deleteResource: { path: { key: 'images/pixel.png' } },
  postBatchOperations: {
    body: {
      operations: [
        { op: 'add', data: { type: 'folder', id: 'images/icons', attributes: { type: 'folder' } } },
        {
          op: 'add',
          data: {
            type: 'asset',
            id: 'images/icons/dot.png',
            attributes: { mimeType: 'image/png', content: PIXEL_PNG },
          },
        },
      ],
    },
  },
};
