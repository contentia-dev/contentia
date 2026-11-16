import type { HttpExample } from '../http-example.js';

const hello = { title: 'Hello world', body: 'My first post.' };
const draft = { title: 'Second post', body: 'Work in progress.' };

/**
 * The Documents API's example requests, keyed by operationId: the values its Try it windows start
 * with. Run top to bottom, they publish `posts/hello-world`, draft `posts/second-post`, and work
 * with both.
 */
export const documentsHttp: Readonly<Record<string, HttpExample>> = {
  listRecords: { query: { 'filter[type]': 'all', 'filter[folder]': 'posts' } },
  listRecordSummaries: { query: { 'filter[type]': 'all', 'filter[folder]': 'posts' } },
  createPublished: {
    body: { data: { type: 'published', id: 'posts/hello-world', attributes: { language: 'en', content: hello } } },
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
        id: 'posts/second-post',
        attributes: { status: 'draft', language: 'en', content: draft },
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
        attributes: { revision: 'v1', language: 'en', content: hello },
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
