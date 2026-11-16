import type { HttpExample } from '../http-example.js';

/** The Catalog API's example requests, keyed by operationId: the values its Try it windows start with. */
export const catalogHttp: Readonly<Record<string, HttpExample>> = {
  createCollection: {
    body: {
      data: {
        type: 'document-collection',
        id: 'posts',
        attributes: { name: 'Posts', directory: 'posts', format: 'json', documentTitleKey: 'title' },
      },
    },
  },
  getCollection: { path: { key: 'posts' } },
  updateCollection: {
    path: { key: 'posts' },
    body: { data: { type: 'document-collection', id: 'posts', attributes: { name: 'Blog posts' } } },
  },
  deleteCollection: { path: { key: 'posts' } },
};
