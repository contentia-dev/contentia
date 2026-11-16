import type { HttpExample } from '../http-example.js';

/**
 * The Catalog API's example requests, keyed by operationId: the values its Try it windows start
 * with. They read and change the sandbox's seeded `posts` collection (`../sandbox-seed.ts`), and
 * create a `pages` one.
 */
export const catalogHttp: Readonly<Record<string, HttpExample>> = {
  createCollection: {
    body: {
      data: {
        type: 'document-collection',
        id: 'pages',
        attributes: { name: 'Pages', directory: 'pages', format: 'json', documentTitleKey: 'title' },
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
