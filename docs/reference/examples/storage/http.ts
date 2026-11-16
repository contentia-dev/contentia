import type { HttpExample } from '../http-example.js';

const post = {
  type: 'object',
  id: 'posts/hello-world',
  attributes: { content: { title: 'Hello world', body: 'My first post.' } },
};

/** The Storage API's cURL examples, keyed by operationId. */
export const storageHttp: Readonly<Record<string, HttpExample>> = {
  listAtoms: { path: { key: 'posts' }, query: { 'filter[depth]': '2' } },
  listAtomSummaries: { path: { key: 'posts' }, query: { 'filter[depth]': '2' } },
  createFolder: { body: { data: { type: 'folder', id: 'posts', attributes: { type: 'folder' } } } },
  createStorageObject: { body: { data: post } },
  getStorageObject: { path: { key: 'posts/hello-world' } },
  updateStorageObject: {
    path: { key: 'posts/hello-world' },
    body: {
      data: {
        ...post,
        attributes: { content: { title: 'Hello again', body: 'My first post, edited.' } },
      },
    },
  },
  deleteStorageObject: { path: { key: 'posts/hello-world' } },
  getFolder: { path: { key: 'posts' } },
  getAtom: { path: { key: 'posts/hello-world' } },
  runAtomicOperations: {
    body: {
      'atomic:operations': [
        { op: 'add', data: post },
        { op: 'remove', ref: { type: 'object', id: 'posts/draft' } },
      ],
    },
  },
};
