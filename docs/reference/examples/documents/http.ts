import type { HttpExample } from '../http-example.js';

/**
 * The Documents API's example requests, keyed by operationId: the values its Try it windows start
 * with. They read and change the sandbox's seed content (`../sandbox-seed.ts`): the published
 * `posts/hello-world` with its revision `v1`, and the draft `posts/second-post`. The ones that
 * create something use a key that isn't in it.
 */
export const documentsHttp: Readonly<Record<string, HttpExample>> = {
  listRecords: { query: { 'filter[type]': 'all', 'filter[folder]': 'posts' } },
  listRecordSummaries: { query: { 'filter[type]': 'all', 'filter[folder]': 'posts' } },
  createPublished: {
    body: {
      data: {
        type: 'published',
        id: 'posts/welcome',
        attributes: { language: 'en', content: { title: 'Welcome', body: 'Thanks for stopping by.' } },
      },
    },
  },
  getPublished: { path: { key: 'posts/hello-world' } },
  updatePublished: {
    path: { key: 'posts/hello-world' },
    body: {
      data: {
        type: 'published',
        id: 'posts/hello-world',
        attributes: { content: { title: 'Hello again', body: 'My first post, edited.' } },
      },
    },
  },
  deletePublished: { path: { key: 'posts/hello-world' } },
  unpublishPublished: {
    path: { key: 'posts/hello-world' },
    body: { data: { type: 'unpublished', attributes: { status: 'draft' } } },
  },
  createUnpublished: {
    body: {
      data: {
        type: 'unpublished',
        id: 'posts/ideas',
        attributes: { status: 'draft', language: 'en', content: { title: 'Ideas', body: 'Things to write about.' } },
      },
    },
  },
  getUnpublished: { path: { key: 'posts/second-post' } },
  updateUnpublished: {
    path: { key: 'posts/second-post' },
    body: {
      data: {
        type: 'unpublished',
        id: 'posts/second-post',
        attributes: { content: { title: 'Second post', body: 'Almost done.' } },
      },
    },
  },
  deleteUnpublished: { path: { key: 'posts/second-post' } },
  publishUnpublished: { path: { key: 'posts/second-post' } },
  createRevision: {
    body: {
      data: {
        type: 'revision',
        id: 'posts/hello-world',
        attributes: { revision: 'v2', language: 'en', content: { title: 'Hello world', body: 'My first post, v2.' } },
      },
    },
  },
  listRevisions: { path: { key: 'posts/hello-world' } },
  getRevision: { path: { key: 'posts/hello-world', revisionId: 'v1' } },
  postBatchOperations: {
    body: {
      operations: [
        {
          op: 'add',
          data: {
            type: 'published',
            id: 'posts/third-post',
            attributes: { content: { title: 'Third post', body: 'Added in a batch.' } },
          },
        },
        {
          op: 'update',
          href: '/unpublish',
          ref: { type: 'document', id: 'posts/third-post' },
          data: {
            type: 'unpublished',
            attributes: { status: 'draft' },
          },
        },
      ],
    },
  },
};
