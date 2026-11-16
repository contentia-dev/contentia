import type { Document, DocumentsRepository, Revision, RevisionSummary, Unpublished } from 'contentia/documents';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, NotImplementedError } from '../../../shared/core/index.js';

export type DocumentsContractCapability =
  | 'createDocument'
  | 'updateDocument'
  | 'deleteDocument'
  | 'listRecords'
  | 'listRecordSummaries'
  | 'createUnpublished'
  | 'updateUnpublished'
  | 'deleteUnpublished'
  | 'publishWorkflow'
  | 'unpublishWorkflow'
  | 'createRevision'
  | 'listRevisions';

export interface DocumentsContractCase {
  name: string;
  makeRepo: () => DocumentsRepository | Promise<DocumentsRepository>;
  teardown?: () => void | Promise<void>;
  skip?: DocumentsContractCapability[];
  /**
   * Optional folder name to scope created keys under. Some impls (e.g.
   * catalog on top of an Obsidian vault) require keys to live inside a
   * configured collection directory.
   */
  collectionFolder?: string;
  /**
   * Optional collection key. Defaults to 'posts'. Must match a collection
   * the impl's settings provider knows about.
   */
  collection?: string;
}

const DEFAULT_PAGINATION = { offset: 0, limit: 100 };

export function runDocumentsRepositoryContract(testCase: DocumentsContractCase): void {
  const { name, makeRepo, teardown, skip = [], collectionFolder = 'posts' } = testCase;

  describe(`DocumentsRepository contract: ${name}`, () => {
    let repo: DocumentsRepository;

    beforeAll(async () => {
      repo = await makeRepo();
    });

    if (teardown) {
      afterAll(async () => {
        await teardown();
      });
    }

    const itOrSkip = (capability: DocumentsContractCapability) => skip.includes(capability) ? it.skip : it;

    const keyIn = (folder: string, slug: string) => `${folder}/${slug}`;

    it('getCapabilities: returns a Capabilities value', async () => {
      const caps = await repo.getCapabilities();
      expect(caps).toBeDefined();
      expect(typeof caps.compatibilityDate).toBe('string');
      expect(caps.pagination).toBeDefined();
      expect(caps.versionTracking).toBeDefined();
      expect(caps.changes).toBeDefined();
    });

    // --- createDocument then getDocument ---
    itOrSkip('createDocument')('createDocument then getDocument: round-trips content', async () => {
      const key = keyIn(collectionFolder, `create-doc-${Date.now()}`);
      const content = { title: 'Hello', n: 42 };

      const created: Document = await repo.createDocument({
        key,
        type: 'published',
        status: 'published',
        content,
        language: 'en',
      });
      expect(created.key).toBe(key);
      expect(created.type).toBe('published');
      expect(created.status).toBe('published');
      expect(created.language).toBe('en');
      expect(created.content).toMatchObject(content);

      const fetched: Document = await repo.getDocument(key);
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('published');
      expect(fetched.content).toMatchObject(content);
    });

    // --- updateDocument ---
    itOrSkip('updateDocument')('updateDocument: getDocument reflects new content', async () => {
      const key = keyIn(collectionFolder, `update-doc-${Date.now()}`);
      const initialContent = { title: 'v1' };
      const updatedContent = { title: 'v2' };

      await repo.createDocument({
        key,
        type: 'published',
        status: 'published',
        content: initialContent,
        language: 'en',
      });
      const updated: Document = await repo.updateDocument({ key, content: updatedContent });
      expect(updated.key).toBe(key);
      expect(updated.content).toMatchObject(updatedContent);

      const fetched: Document = await repo.getDocument(key);
      expect(fetched.content).toMatchObject(updatedContent);
    });

    // --- deleteDocument ---
    itOrSkip('deleteDocument')('deleteDocument: subsequent getDocument fails with NotFoundError', async () => {
      const key = keyIn(collectionFolder, `delete-doc-${Date.now()}`);
      await repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' });
      await repo.deleteDocument(key);

      await expect(repo.getDocument(key).run()).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- listRecords ---
    itOrSkip('listRecords')('listRecords after create: returns created docs', async () => {
      const stamp = Date.now();
      const keys = [
        keyIn(collectionFolder, `list-a-${stamp}`),
        keyIn(collectionFolder, `list-b-${stamp}`),
        keyIn(collectionFolder, `list-c-${stamp}`),
      ];

      for (const key of keys) {
        await repo.createDocument({
          key,
          type: 'published',
          status: 'published',
          content: { key },
          language: 'en',
        });
      }

      const { items } = await repo.listRecords({
        folder: collectionFolder,
        depth: 1,
        pagination: DEFAULT_PAGINATION,
      }).collect();
      const returnedKeys = (items as ReadonlyArray<unknown> as Array<{ key?: string }>)
        .map(r => r.key)
        .filter((k): k is string => typeof k === 'string');
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- listRecordSummaries ---
    itOrSkip('listRecordSummaries')(
      'listRecordSummaries after create: returns created docs',
      async () => {
        const stamp = Date.now();
        const keys = [
          keyIn(collectionFolder, `summary-a-${stamp}`),
          keyIn(collectionFolder, `summary-b-${stamp}`),
        ];
        for (const key of keys) {
          await repo.createDocument({
            key,
            type: 'published',
            status: 'published',
            content: { key },
            language: 'en',
          });
        }

        const { items } = await repo.listRecordSummaries({
          folder: collectionFolder,
          depth: 1,
          pagination: DEFAULT_PAGINATION,
        }).collect();
        const returnedKeys = (items as ReadonlyArray<unknown> as Array<{ key?: string }>)
          .map(s => s.key)
          .filter((k): k is string => typeof k === 'string');
        for (const key of keys) {
          expect(returnedKeys).toContain(key);
        }
      },
    );

    // --- createUnpublished then getUnpublished ---
    itOrSkip('createUnpublished')(
      'createUnpublished then getUnpublished: round-trips content',
      async () => {
        const key = keyIn(collectionFolder, `create-draft-${Date.now()}`);
        const content = { title: 'Draft', stage: 'wip' };

        const created: Unpublished = await repo.createUnpublished({
          key,
          type: 'unpublished',
          status: 'draft',
          content,
          language: 'en',
        });
        expect(created.key).toBe(key);
        expect(created.type).toBe('unpublished');
        expect(created.status).toBe('draft');
        expect(created.content).toMatchObject(content);

        const fetched: Unpublished = await repo.getUnpublished(key);
        expect(fetched.key).toBe(key);
        expect(fetched.content).toMatchObject(content);
      },
    );

    // --- updateUnpublished ---
    itOrSkip('updateUnpublished')(
      'updateUnpublished: getUnpublished reflects new content',
      async () => {
        const key = keyIn(collectionFolder, `update-draft-${Date.now()}`);
        await repo.createUnpublished({
          key,
          type: 'unpublished',
          status: 'draft',
          content: { v: 1 },
          language: 'en',
        });
        const updated: Unpublished = await repo.updateUnpublished({ key, content: { v: 2 } });
        expect(updated.content).toMatchObject({ v: 2 });

        const fetched: Unpublished = await repo.getUnpublished(key);
        expect(fetched.content).toMatchObject({ v: 2 });
      },
    );

    // --- deleteUnpublished ---
    itOrSkip('deleteUnpublished')(
      'deleteUnpublished: subsequent getUnpublished fails with NotFoundError',
      async () => {
        const key = keyIn(collectionFolder, `delete-draft-${Date.now()}`);
        await repo.createUnpublished({
          key,
          type: 'unpublished',
          status: 'draft',
          content: {},
          language: 'en',
        });
        await repo.deleteUnpublished(key);

        await expect(repo.getUnpublished(key).run()).rejects.toMatchObject({ code: NotFoundError.CODE });
      },
    );

    // --- publish: unpublished → published ---
    itOrSkip('publishWorkflow')(
      'publish: createUnpublished then publish → getDocument succeeds',
      async () => {
        const key = keyIn(collectionFolder, `publish-${Date.now()}`);
        await repo.createUnpublished({
          key,
          type: 'unpublished',
          status: 'draft',
          content: { ready: true },
          language: 'en',
        });

        const published: Document = await repo.publish(key);
        expect(published.type).toBe('published');
        expect(published.key).toBe(key);

        const fetched: Document = await repo.getDocument(key);
        expect(fetched.key).toBe(key);
        expect(fetched.content).toMatchObject({ ready: true });
      },
    );

    // --- unpublish: published → unpublished ---
    itOrSkip('unpublishWorkflow')(
      'unpublish: createDocument then unpublish(draft) → getUnpublished succeeds',
      async () => {
        const key = keyIn(collectionFolder, `unpublish-${Date.now()}`);
        await repo.createDocument({
          key,
          type: 'published',
          status: 'published',
          content: { headline: 'live' },
          language: 'en',
        });

        const unpublished: Unpublished = await repo.unpublish(key, 'draft');
        expect(unpublished.type).toBe('unpublished');
        expect(unpublished.status).toBe('draft');
        expect(unpublished.key).toBe(key);

        const fetched: Unpublished = await repo.getUnpublished(key);
        expect(fetched.content).toMatchObject({ headline: 'live' });
      },
    );

    // --- createRevision then getRevision ---
    itOrSkip('createRevision')(
      'createRevision then getRevision: round-trips revision content',
      async () => {
        const key = keyIn(collectionFolder, `revision-${Date.now()}`);
        const rev = 'v1';
        const content = { text: 'original' };

        const created: Revision = await repo.createRevision({
          key,
          type: 'revision',
          revision: rev,
          content,
          language: 'en',
        });
        expect(created.revision).toBe(rev);
        expect(created.content).toMatchObject(content);

        const fetched: Revision = await repo.getRevision(key, rev);
        expect(fetched.revision).toBe(rev);
        expect(fetched.content).toMatchObject(content);
      },
    );

    // --- listRevisions ---
    itOrSkip('listRevisions')('listRevisions after create: returns created revisions', async () => {
      const key = keyIn(collectionFolder, `list-rev-${Date.now()}`);
      const revs = ['v1', 'v2'];
      for (const rev of revs) {
        await repo.createRevision({
          key,
          type: 'revision',
          revision: rev,
          content: { rev },
          language: 'en',
        });
      }

      const { items } = await repo.listRevisions(key, { pagination: DEFAULT_PAGINATION }).collect();
      const returnedRevs = (items as RevisionSummary[]).map(s => s.revision);
      for (const rev of revs) {
        expect(returnedRevs).toContain(rev);
      }
    });

    // --- version tracking (capability-gated) ---
    it('version: a new version token appears on every content change (when supported)', async () => {
      const caps = await repo.getCapabilities();
      if (!caps.versionTracking.supported) return; // soft-skip: not advertised

      const key = keyIn(collectionFolder, `version-${Date.now()}`);
      const created: Document = await repo.createDocument({
        key,
        type: 'published',
        status: 'published',
        content: { v: 1 },
        language: 'en',
      });
      expect(typeof created.version).toBe('string');

      const updated: Document = await repo.updateDocument({ key, content: { v: 2 } });
      expect(typeof updated.version).toBe('string');
      expect(updated.version).not.toBe(created.version);

      // Version is stable across reads without intervening writes.
      const fetched: Document = await repo.getDocument(key);
      expect(fetched.version).toBe(updated.version);
    });

    // --- sync token (capability-gated) ---
    it('getSyncToken: token changes after a write (when supported)', async () => {
      const caps = await repo.getCapabilities();
      if (!caps.changes.supported || !caps.changes.syncToken) return; // soft-skip

      const before = await repo.getSyncToken();
      const key = keyIn(collectionFolder, `sync-${Date.now()}`);
      await repo.createDocument({ key, type: 'published', status: 'published', content: {}, language: 'en' });
      const after = await repo.getSyncToken();
      expect(after).not.toBe(before);

      // Without intervening writes the token is stable.
      const again = await repo.getSyncToken();
      expect(again).toBe(after);
    });

    it('getSyncToken: fails with NotImplementedError when not advertised', async () => {
      const caps = await repo.getCapabilities();
      if (caps.changes.supported && caps.changes.syncToken) return; // soft-skip: supported

      await expect(repo.getSyncToken().run()).rejects.toMatchObject({ code: NotImplementedError.CODE });
    });

    // --- change feed (capability-gated) ---
    it('listChanges: reports keys changed since a sync token (when supported)', async () => {
      const caps = await repo.getCapabilities();
      if (!caps.changes.supported || !caps.changes.changeFeed) return; // soft-skip

      const since = await repo.getSyncToken();
      const key = keyIn(collectionFolder, `changes-${Date.now()}`);
      await repo.createDocument({ key, type: 'published', status: 'published', content: { a: 1 }, language: 'en' });

      const { items, done } = await repo.listChanges({ since }).collect();
      const changed = items.find(c => c.key === key);
      expect(changed).toBeDefined();
      expect(changed!.deleted).toBe(false);
      expect(typeof done.syncToken).toBe('string');

      // Resuming from the returned token yields no further changes for the key.
      const next = await repo.listChanges({ since: done.syncToken }).collect();
      expect(next.items.find(c => c.key === key)).toBeUndefined();
    });

    it('listChanges: fails with NotImplementedError when not advertised', async () => {
      const caps = await repo.getCapabilities();
      if (caps.changes.supported && caps.changes.changeFeed) return; // soft-skip: supported

      const since = await repo.getSyncToken().run().catch(() => undefined);
      await expect(
        repo.listChanges({ since: (since ?? '0') as Parameters<typeof repo.listChanges>[0]['since'] }).collect(),
      ).rejects.toMatchObject({ code: NotImplementedError.CODE });
    });
  });
}
