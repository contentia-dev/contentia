import type { HttpExample } from '../http-example.js';

const about = {
  type: 'object',
  id: 'pages/about',
  attributes: { content: { title: 'About', body: 'About this site.' } },
};

/**
 * The Storage API's example requests, keyed by operationId: its cURL examples, and the values its
 * Try it windows start with. They read and change the sandbox's seed content
 * (`../sandbox-seed.ts`), and create what isn't in it.
 */
export const storageHttp: Readonly<Record<string, HttpExample>> = {
  listAtoms: { path: { key: 'posts' }, query: { 'filter[depth]': '2' } },
  listAtomSummaries: { path: { key: 'posts' }, query: { 'filter[depth]': '2' } },
  createFolder: { body: { data: { type: 'folder', id: 'pages', attributes: { type: 'folder' } } } },
  createStorageObject: { body: { data: about } },
  getStorageObject: { path: { key: 'posts/hello-world' } },
  updateStorageObject: {
    path: { key: 'posts/hello-world' },
    body: {
      data: {
        type: 'object',
        id: 'posts/hello-world',
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
        { op: 'add', data: { ...about, id: 'pages/contact', attributes: { content: { title: 'Contact' } } } },
        {
          op: 'update',
          data: { type: 'object', id: 'settings/site', attributes: { content: { title: 'My new site' } } },
        },
      ],
    },
  },
};
