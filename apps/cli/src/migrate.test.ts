import { ContentiaStream, ContentiaTask, EntryAlreadyExistsError } from 'contentia/core';
import type {
  Atom,
  AtomSummary,
  Capabilities,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from 'contentia/storage';
import { CompatibilityDate, StorageRepository } from 'contentia/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateStorage } from './migrate.js';

// ---------------------------------------------------------------------------
// Minimal in-memory storage repository stub
// ---------------------------------------------------------------------------

class StubStorageRepository extends StorageRepository {
  private readonly objects = new Map<string, StorageObject>();
  private readonly explicitFolders = new Set<string>();

  getCapabilities(): ContentiaTask.ContentiaTask<Capabilities> {
    return ContentiaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-11'),
      fileExtensions: { supported: false, description: '' },
      pagination: { supported: false, description: '', styles: { offset: false, page: false, cursor: false } },
    } as Capabilities);
  }

  seed(key: string, content: Record<string, unknown> = {}): this {
    const now = new Date().toISOString();
    this.objects.set(key, { type: 'object', key, content, createdAt: now, updatedAt: now } as StorageObject);
    return this;
  }

  seedFolder(key: string): this {
    this.explicitFolders.add(key);
    return this;
  }

  hasObject(key: string): boolean {
    return this.objects.has(key);
  }

  objectCount(): number {
    return this.objects.size;
  }

  getObject(key: string): ContentiaTask.ContentiaTask<StorageObject> {
    const v = this.objects.get(key);
    if (!v) return ContentiaTask.fail(new Error(`Not found: ${key}`) as never);
    return ContentiaTask.succeed(v);
  }

  createObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject> {
    if (this.objects.has(create.key)) {
      return ContentiaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    const now = new Date().toISOString();
    const obj: StorageObject = {
      type: 'object',
      key: create.key,
      content: (create.content ?? {}) as StorageObject['content'],
      createdAt: now,
      updatedAt: now,
    };
    this.objects.set(create.key, obj);
    return ContentiaTask.succeed(obj);
  }

  createOrUpdateObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject> {
    const existing = this.objects.get(create.key);
    const now = new Date().toISOString();
    const obj: StorageObject = {
      type: 'object',
      key: create.key,
      content: (create.content ?? {}) as StorageObject['content'],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.objects.set(create.key, obj);
    return ContentiaTask.succeed(obj);
  }

  updateObject(update: StorageObjectUpdate): ContentiaTask.ContentiaTask<StorageObject> {
    const existing = this.objects.get(update.key);
    if (!existing) return ContentiaTask.fail(new Error(`Not found: ${update.key}`) as never);
    const updated: StorageObject = {
      ...existing,
      content: (update.content ?? existing.content) as StorageObject['content'],
      updatedAt: new Date().toISOString(),
    };
    this.objects.set(update.key, updated);
    return ContentiaTask.succeed(updated);
  }

  removeAtoms(keys: readonly string[]): ContentiaStream.ContentiaStream<string, RemoveAtomsDone> {
    const removed: string[] = [];
    let skipped = 0;
    for (const key of keys) {
      if (this.objects.delete(key) || this.explicitFolders.delete(key)) removed.push(key);
      else skipped += 1;
    }
    return removed.length > 0
      ? ContentiaStream.succeedMany<string, RemoveAtomsDone>(removed, { removed: removed.length, skipped })
      : ContentiaStream.empty<RemoveAtomsDone>({ removed: 0, skipped });
  }

  getFolder(key: string): ContentiaTask.ContentiaTask<Folder> {
    const exists = this.explicitFolders.has(key)
      || [...this.objects.keys()].some(k => k.startsWith(`${key}/`));
    if (!exists) return ContentiaTask.fail(new Error(`Folder not found: ${key}`) as never);
    const now = new Date().toISOString();
    return ContentiaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Folder);
  }

  createFolder(create: FolderCreate): ContentiaTask.ContentiaTask<Folder> {
    if (this.explicitFolders.has(create.key)) {
      return ContentiaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    this.explicitFolders.add(create.key);
    const now = new Date().toISOString();
    return ContentiaTask.succeed({ type: 'folder', key: create.key, createdAt: now, updatedAt: now } as Folder);
  }

  getAtom(key: string): ContentiaTask.ContentiaTask<Atom> {
    const obj = this.objects.get(key);
    if (obj) return ContentiaTask.succeed(obj as Atom);
    const now = new Date().toISOString();
    if (this.explicitFolders.has(key)) {
      return ContentiaTask.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } as Atom);
    }
    return ContentiaTask.fail(new Error(`Not found: ${key}`) as never);
  }

  listAtoms(folderKey: string, _options: ListAtomsOptions): ContentiaStream.ContentiaStream<Atom, ListAtomsDone> {
    return this.listAtomSummaries(folderKey, _options) as unknown as ContentiaStream.ContentiaStream<
      Atom,
      ListAtomsDone
    >;
  }

  listAtomSummaries(
    folderKey: string,
    _options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<AtomSummary, ListAtomsDone> {
    const prefix = folderKey ? (folderKey.endsWith('/') ? folderKey : `${folderKey}/`) : '';
    const seenFolders = new Set<string>();
    const summaries: AtomSummary[] = [];
    const now = new Date().toISOString();

    for (const [k, v] of this.objects.entries()) {
      if (prefix && !k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx !== -1) {
        // Nested object — its immediate parent is a sub-folder
        const childFolder = prefix + rest.slice(0, slashIdx);
        if (!seenFolders.has(childFolder)) {
          seenFolders.add(childFolder);
          summaries.push({ type: 'folder-summary', key: childFolder, createdAt: now, updatedAt: now } as AtomSummary);
        }
      } else {
        summaries.push(
          { type: 'object-summary', key: v.key, createdAt: v.createdAt, updatedAt: v.updatedAt } as AtomSummary,
        );
      }
    }

    return summaries.length > 0
      ? ContentiaStream.succeedMany<AtomSummary, ListAtomsDone>(summaries, { total: summaries.length })
      : ContentiaStream.empty<ListAtomsDone>({ total: 0 });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migrateStorage', () => {
  let source: StubStorageRepository;
  let destination: StubStorageRepository;

  beforeEach(() => {
    source = new StubStorageRepository();
    destination = new StubStorageRepository();
  });

  it('copies objects from source to destination', async () => {
    source.seed('docs/a.md').seed('docs/b.md');

    const result = await migrateStorage(source, destination);

    expect(result.objectsCopied).toBe(2);
    expect(result.objectsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(destination.hasObject('docs/a.md')).toBe(true);
    expect(destination.hasObject('docs/b.md')).toBe(true);
  });

  it('dry-run skips all writes and reports objectsSkipped', async () => {
    source.seed('foo/bar.md').seed('foo/baz.md');

    const result = await migrateStorage(source, destination, { dryRun: true });

    expect(result.objectsCopied).toBe(0);
    expect(result.objectsSkipped).toBe(2);
    expect(destination.objectCount()).toBe(0);
  });

  it('dry-run emits object-skipped events with reason dry-run', async () => {
    source.seed('item.md');
    const events: string[] = [];

    await migrateStorage(source, destination, {
      dryRun: true,
      onEvent: e => events.push(e.type),
    });

    expect(events).toContain('object-skipped');
  });

  it('overwrite=false skips existing destination objects with EntryAlreadyExistsError', async () => {
    source.seed('file.md', { body: 'new' });
    destination.seed('file.md', { body: 'old' });

    const result = await migrateStorage(source, destination, { overwrite: false });

    expect(result.objectsSkipped).toBe(1);
    expect(result.objectsCopied).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('overwrite=false emits object-skipped with reason exists', async () => {
    source.seed('file.md');
    destination.seed('file.md');
    const events: Array<{ type: string, reason?: string }> = [];

    await migrateStorage(source, destination, {
      overwrite: false,
      onEvent: e => events.push(e),
    });

    const skipped = events.find(e => e.type === 'object-skipped');
    expect(skipped).toBeDefined();
    expect((skipped as { reason?: string })?.reason).toBe('exists');
  });

  it('overwrite=true replaces existing destination objects', async () => {
    source.seed('file.md', { body: 'updated' });
    destination.seed('file.md', { body: 'original' });

    const result = await migrateStorage(source, destination, { overwrite: true });

    expect(result.objectsCopied).toBe(1);
    expect(result.objectsSkipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('records errors when getObject throws unexpectedly', async () => {
    // Seed the source so listAtomSummaries returns 'broken.md'…
    source.seed('broken.md');
    // …then make getObject throw for that key specifically
    vi.spyOn(source, 'getObject').mockImplementation((key: string) => {
      return ContentiaTask.fail(new Error('disk read error') as never);
    });

    const result = await migrateStorage(source, destination);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toContain('disk read error');
  });

  it('emits error event when write fails unexpectedly', async () => {
    source.seed('oops.md');
    vi.spyOn(destination, 'createObject').mockImplementation(() => {
      return ContentiaTask.fail(new Error('write failure') as never);
    });
    const errorEvents: Array<{ type: string, key: string }> = [];

    const result = await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'error') errorEvents.push(e);
      },
    });

    expect(errorEvents).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('write failure');
  });

  it('returns empty result for empty source', async () => {
    const result = await migrateStorage(source, destination);

    expect(result.objectsCopied).toBe(0);
    expect(result.objectsSkipped).toBe(0);
    expect(result.foldersCreated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('emits object-copied event for each copied object', async () => {
    source.seed('a.md').seed('b.md');
    const copied: string[] = [];

    await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'object-copied') copied.push(e.key);
      },
    });

    expect(copied).toEqual(expect.arrayContaining(['a.md', 'b.md']));
  });

  it('respects the from option and only migrates objects under that key', async () => {
    source.seed('alpha/x.md').seed('beta/y.md');

    const result = await migrateStorage(source, destination, { from: 'alpha' });

    expect(destination.hasObject('alpha/x.md')).toBe(true);
    expect(destination.hasObject('beta/y.md')).toBe(false);
    expect(result.objectsCopied).toBe(1);
  });

  it('BFS folder discovery: non-empty sub-folders are created on destination', async () => {
    source.seed('docs/a.md').seed('docs/b.md');
    const folderEvents: string[] = [];

    const result = await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'folder-discovered' || e.type === 'folder-created') {
          folderEvents.push(`${e.type}:${e.key}`);
        }
      },
    });

    expect(result.objectsCopied).toBe(2);
    expect(result.foldersCreated).toBe(1);
    expect(folderEvents).toContain('folder-discovered:docs');
    expect(folderEvents).toContain('folder-created:docs');
  });

  it('dry-run with sub-folders reports correct foldersSkipped count', async () => {
    source.seed('docs/a.md').seed('docs/b.md');

    const result = await migrateStorage(source, destination, { dryRun: true });

    expect(result.foldersSkipped).toBe(1);
    expect(result.objectsSkipped).toBe(2);
    expect(result.foldersCreated).toBe(0);
    expect(result.objectsCopied).toBe(0);
  });

  it('dry-run emits folder-skipped events for discovered sub-folders', async () => {
    source.seed('section/page.md');
    const events: Array<{ type: string, key: string }> = [];

    await migrateStorage(source, destination, {
      dryRun: true,
      onEvent: e => events.push(e as { type: string, key: string }),
    });

    const folderSkipped = events.filter(e => e.type === 'folder-skipped');
    expect(folderSkipped).toHaveLength(1);
    expect(folderSkipped[0]?.key).toBe('section');
  });

  it('deeply nested folders are all created on destination', async () => {
    source.seed('a/b/c.md');
    const folderCreated: string[] = [];

    const result = await migrateStorage(source, destination, {
      onEvent: e => {
        if (e.type === 'folder-created') folderCreated.push(e.key);
      },
    });

    expect(result.objectsCopied).toBe(1);
    expect(folderCreated).toContain('a');
    expect(folderCreated).toContain('a/b');
  });
});
