/**
 * The content the API reference's sandbox starts with (see `.vitepress/theme/api-sandbox.ts`):
 * JSON:API requests, replayed once per tab before its first Try it request. The example requests
 * (`<api>/http.ts`) are written against it: an example that reads, changes or deletes something
 * finds it here, and one that creates something uses a key that isn't here, so each succeeds when
 * it's the first request sent.
 */

/** A request to one of the sandbox's APIs, by name, with its path under that API. */
export interface SeedRequest {
  readonly api: 'storage' | 'documents' | 'assets' | 'catalog';
  readonly path: string;
  readonly body: unknown;
}

/** A 1×1 PNG, base64-encoded: small enough to send as a JSON:API attribute. */
export const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Every seed request is a POST. */
export const SANDBOX_SEED: readonly SeedRequest[] = [
  {
    api: 'catalog',
    path: '/collections',
    body: {
      data: {
        type: 'document-collection',
        id: 'posts',
        attributes: {
          name: 'Posts',
          directory: 'posts',
          format: 'json',
          documentTitleKey: 'title',
          unpublishedStatuses: {
            draft: { directory: 'draft', name: 'Draft' },
            archived: { directory: 'archived', name: 'Archived' },
          },
        },
      },
    },
  },
  {
    api: 'catalog',
    path: '/collections',
    body: {
      data: {
        type: 'media-collection',
        id: 'images',
        attributes: { name: 'Images', directory: 'images', accept: ['image/*'] },
      },
    },
  },
  {
    api: 'documents',
    path: '/published',
    body: {
      data: {
        type: 'published',
        id: 'posts/hello-world',
        attributes: { language: 'en', content: { title: 'Hello world', body: 'My first post.' } },
      },
    },
  },
  {
    api: 'documents',
    path: '/revisions',
    body: {
      data: {
        type: 'revision',
        id: 'posts/hello-world',
        attributes: { revision: 'v1', language: 'en', content: { title: 'Hello world', body: 'My first post.' } },
      },
    },
  },
  {
    api: 'documents',
    path: '/unpublished',
    body: {
      data: {
        type: 'unpublished',
        id: 'posts/second-post',
        attributes: { status: 'draft', language: 'en', content: { title: 'Second post', body: 'Work in progress.' } },
      },
    },
  },
  {
    api: 'assets',
    path: '/resources',
    body: {
      data: {
        type: 'asset',
        id: 'images/pixel.png',
        attributes: { mimeType: 'image/png', filename: 'pixel.png', content: PIXEL_PNG },
      },
    },
  },
  {
    api: 'storage',
    path: '/objects',
    body: {
      data: { type: 'object', id: 'settings/site', attributes: { content: { title: 'My site', language: 'en' } } },
    },
  },
];
