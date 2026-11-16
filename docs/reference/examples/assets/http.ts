import type { HttpExample } from '../http-example.js';

/** A 1×1 PNG, base64-encoded: small enough to send as a JSON:API attribute. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** The Assets API's example requests, keyed by operationId: the values its Try it windows start with. */
export const assetsHttp: Readonly<Record<string, HttpExample>> = {
  listResources: { query: { folder: 'images' } },
  createResource: {
    body: {
      data: {
        type: 'asset',
        id: 'images/pixel.png',
        attributes: { mimeType: 'image/png', filename: 'pixel.png', content: PIXEL_PNG },
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
