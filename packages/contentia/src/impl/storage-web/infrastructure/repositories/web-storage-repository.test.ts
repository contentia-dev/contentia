import { IllegalStateException, QuotaExceededError } from 'contentia/core';
import type { StorageFormat, StorageObjectContent, StorageSerializer } from 'contentia/storage';
import { describe, expect, it } from 'vitest';

import { InMemoryWebStorage } from '../../testing.js';
import { WebStorageRepository } from './web-storage-repository.js';

const jsonSerializer: StorageSerializer<StorageFormat> = {
  format: 'json' as StorageFormat,
  async serializeDocumentFileContents(content: StorageObjectContent): Promise<string> {
    return JSON.stringify(content);
  },
  async deserializeDocumentFileContents(raw: string): Promise<StorageObjectContent> {
    return JSON.parse(raw);
  },
};

describe('WebStorageRepository: namespace isolation', () => {
  it("two repositories sharing one Storage under different namespaces never see each other's keys", async () => {
    const shared = new InMemoryWebStorage();
    const repoA = new WebStorageRepository({
      storage: shared,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
      namespace: 'app-a',
    });
    const repoB = new WebStorageRepository({
      storage: shared,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
      namespace: 'app-b',
    });

    await repoA.createObject({ key: 'shared-key', type: 'object', content: { owner: 'a' } });
    await repoB.createObject({ key: 'shared-key', type: 'object', content: { owner: 'b' } });

    const fromA = await repoA.getObject('shared-key');
    const fromB = await repoB.getObject('shared-key');
    expect(fromA.content).toMatchObject({ owner: 'a' });
    expect(fromB.content).toMatchObject({ owner: 'b' });

    // Deleting from one namespace must not remove the other namespace's object.
    await repoA.removeAtoms(['shared-key']).collect();
    await expect(repoA.getObject('shared-key').run()).rejects.toThrow();
    const stillThere = await repoB.getObject('shared-key');
    expect(stillThere.content).toMatchObject({ owner: 'b' });
  });

  it('a repository never touches unrelated, non-namespaced data already in the same Storage', async () => {
    const shared = new InMemoryWebStorage();
    shared.setItem('some-other-app-setting', 'do-not-touch');

    const repo = new WebStorageRepository({
      storage: shared,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
      namespace: 'contentia',
    });
    await repo.createObject({ key: 'a', type: 'object', content: {} });
    await repo.removeAtoms(['a']).collect();

    expect(shared.getItem('some-other-app-setting')).toBe('do-not-touch');
  });
});

describe('WebStorageRepository: quota-exceeded mapping', () => {
  it('maps a QuotaExceededError-like setItem failure to the typed domain error, not a raw throw', async () => {
    const shared = new InMemoryWebStorage();
    shared.setItem = () => {
      const err = new Error('The quota has been exceeded.');
      err.name = 'QuotaExceededError';
      throw err;
    };

    const repo = new WebStorageRepository({
      storage: shared,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });

    await expect(
      repo.createObject({ key: 'too-big', type: 'object', content: { big: 'x'.repeat(10) } }).run(),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe('WebStorageRepository: SSR safety', () => {
  it('constructing without a `storage` option never touches globalThis.localStorage', () => {
    let touched = false;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        touched = true;
        return undefined;
      },
    });
    try {
      const repo = new WebStorageRepository({ serializerRegistry: { json: jsonSerializer }, defaultExtension: 'json' });
      expect(repo).toBeInstanceOf(WebStorageRepository);
      expect(touched).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('using an unconfigured repository with no global localStorage fails with a typed error, not a raw exception', async () => {
    // This test's environment (Node/vitest, no jsdom) has no globalThis.localStorage by
    // default — the same shape SSR runs in.
    expect((globalThis as { localStorage?: Storage }).localStorage).toBeUndefined();

    const repo = new WebStorageRepository({ serializerRegistry: { json: jsonSerializer }, defaultExtension: 'json' });
    await expect(repo.getObject('anything').run()).rejects.toBeInstanceOf(IllegalStateException);
  });

  it('getCapabilities works without ever needing a Storage', async () => {
    const repo = new WebStorageRepository({ serializerRegistry: { json: jsonSerializer }, defaultExtension: 'json' });
    const caps = await repo.getCapabilities();
    expect(caps.fileExtensions.supported).toBe(true);
  });
});
