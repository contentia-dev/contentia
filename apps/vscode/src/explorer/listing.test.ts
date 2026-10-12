import { describe, expect, it } from 'vitest';

import { LaikaTask } from 'laikacms/core';
import { InMemoryDocumentsRepository } from 'laikacms/documents/testing';
import { InMemoryStorageRepository } from 'laikacms/storage/testing';

import { labelOf, listDocumentsFolder, listStorageFolder, PAGE_SIZE } from './listing.js';

describe('labelOf', () => {
  it('shows the last key segment', () => {
    expect(labelOf('posts/2026/hello')).toBe('hello');
    expect(labelOf('settings')).toBe('settings');
  });
});

describe('listStorageFolder', () => {
  // The in-memory stub never lists folders; folder rows are covered against
  // the real fs backend in serve-process.test.ts.
  const seed = async (keys: string[]) => {
    const repo = new InMemoryStorageRepository();
    for (const key of keys) await LaikaTask.runPromise(repo.createObject({ key, content: { key } }));
    return repo;
  };

  it('lists only direct children, sorted by label', async () => {
    const repo = await seed(['zeta', 'alpha', 'posts/hello']);
    const page = await listStorageFolder(repo, '', 1);
    expect(page.entries.map(e => [e.kind, e.key])).toEqual([['object', 'alpha'], ['object', 'zeta']]);
    expect(page.nextPage).toBeUndefined();
  });

  it('lists inside a folder by its full key and labels by the last segment', async () => {
    const repo = await seed(['posts/hello', 'posts/world']);
    const page = await listStorageFolder(repo, 'posts', 1);
    expect(page.entries.map(e => [e.key, e.label])).toEqual([['posts/hello', 'hello'], ['posts/world', 'world']]);
  });

  it('offers a next page until the folder is exhausted', async () => {
    const repo = await seed(Array.from({ length: PAGE_SIZE + 1 }, (_, i) => `item-${String(i).padStart(3, '0')}`));
    const first = await listStorageFolder(repo, '', 1);
    expect(first.entries).toHaveLength(PAGE_SIZE);
    expect(first.nextPage).toBe(2);
    const second = await listStorageFolder(repo, '', 2);
    expect(second.entries.map(e => e.key)).toEqual([`item-${PAGE_SIZE}`]);
    expect(second.nextPage).toBeUndefined();
  });
});

describe('listDocumentsFolder', () => {
  const seed = async () => {
    const repo = new InMemoryDocumentsRepository();
    await LaikaTask.runPromise(repo.createDocument({
      key: 'posts/hello',
      type: 'published',
      status: 'published',
      language: 'en',
      content: { title: 'Hello' },
    }));
    await LaikaTask.runPromise(repo.createUnpublished({
      key: 'posts/draft',
      type: 'unpublished',
      status: 'draft',
      language: 'nl',
      content: { title: 'Concept' },
    }));
    return repo;
  };

  it('lists collections as folders at the root', async () => {
    const page = await listDocumentsFolder(await seed(), undefined, 1);
    expect(page.entries).toEqual([{ kind: 'folder', key: 'posts', label: 'posts' }]);
  });

  it('lists published and unpublished records with their status and language', async () => {
    const page = await listDocumentsFolder(await seed(), 'posts', 1);
    expect(page.entries.map(e => e.kind === 'record' && [e.key, e.status, e.published, e.language])).toEqual([
      ['posts/draft', 'draft', false, 'nl'],
      ['posts/hello', 'published', true, 'en'],
    ]);
  });
});
