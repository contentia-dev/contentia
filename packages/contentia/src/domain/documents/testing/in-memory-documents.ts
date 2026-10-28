// Package-specifier imports on purpose (not relative ones): the API servers
// and proxies resolve `contentia/*` through the package's own exports, so the
// error classes thrown here must be the same class objects those layers
// `instanceof`-check against.
import { ContentiaStream, ContentiaTask, EntryAlreadyExistsError, InvalidData, NotFoundError } from 'contentia/core';
import type {
  Document,
  DocumentCreate,
  DocumentsCapabilities,
  DocumentUpdate,
  GetSyncTokenOptions,
  ListChangesDone,
  ListChangesOptions,
  ListRecordsDone,
  ListRecordsOptions,
  ListRevisionsDone,
  ListRevisionsOptions,
  Record,
  RecordSummary,
  Revision,
  RevisionCreate,
  RevisionSummary,
  Unpublished,
  UnpublishedCreate,
  UnpublishedUpdate,
} from 'contentia/documents';
import { DocumentsCompatibilityDate, DocumentsRepository } from 'contentia/documents';
import { applyPagination, type ChangeSummary, SyncToken } from 'contentia/storage';

interface ChangeLogEntry {
  seq: number;
  key: string;
  version?: string;
  deleted: boolean;
}

/**
 * A `DocumentsRepository` backed by in-memory `Map`s. The reference
 * implementation of the full contract surface, including the capability-gated
 * change signals: every mutation bumps a monotonically increasing counter
 * that doubles as the per-record `version` source and the per-store sync
 * token, and appends to an in-memory change log served by `listChanges`.
 *
 * Intended for tests: it gives the version tracking / sync token / change
 * feed surface real coverage without a backing store.
 */
export class InMemoryDocumentsRepository extends DocumentsRepository {
  private readonly published = new Map<string, Document>();
  private readonly unpublished = new Map<string, Unpublished>();
  private readonly revisions = new Map<string, Map<string, Revision>>();
  private readonly changeLog: ChangeLogEntry[] = [];
  private seq = 0;

  private nextVersion(): string {
    this.seq += 1;
    return `v${this.seq}`;
  }

  private logChange(key: string, version: string | undefined, deleted: boolean): void {
    this.changeLog.push({ seq: this.seq, key, version, deleted });
  }

  private currentToken(): SyncToken {
    return SyncToken.make(String(this.seq));
  }

  getCapabilities(): ContentiaTask.ContentiaTask<DocumentsCapabilities> {
    return ContentiaTask.succeed<DocumentsCapabilities>({
      compatibilityDate: DocumentsCompatibilityDate.make('2026-07-16'),
      pagination: {
        supported: true,
        description: 'Naive in-memory slicing by offset/limit.',
        styles: { offset: true, page: true, cursor: false },
      },
      versionTracking: {
        supported: true,
        description: 'Monotonic in-memory counter; a record gets a new version on every write.',
      },
      changes: {
        supported: true,
        description: 'In-memory change log; the sync token is the current counter value.',
        syncToken: true,
        changeFeed: true,
      },
    });
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  getDocument(key: string): ContentiaTask.ContentiaTask<Document> {
    const doc = this.published.get(key);
    if (!doc) return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    return ContentiaTask.succeed(doc);
  }

  createDocument(create: DocumentCreate): ContentiaTask.ContentiaTask<Document> {
    if (this.published.has(create.key)) {
      return ContentiaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    const now = new Date().toISOString();
    const version = this.nextVersion();
    const doc: Document = {
      key: create.key,
      type: 'published',
      status: 'published',
      language: create.language,
      content: create.content,
      version,
      createdAt: now,
      updatedAt: now,
    };
    this.published.set(create.key, doc);
    this.logChange(create.key, version, false);
    return ContentiaTask.succeed(doc);
  }

  updateDocument(update: DocumentUpdate): ContentiaTask.ContentiaTask<Document> {
    const existing = this.published.get(update.key);
    if (!existing) return ContentiaTask.fail(new NotFoundError(`Not found: ${update.key}`));
    const version = this.nextVersion();
    const updated: Document = {
      ...existing,
      language: update.language ?? existing.language,
      content: update.content ?? existing.content,
      version,
      updatedAt: new Date().toISOString(),
    };
    this.published.set(update.key, updated);
    this.logChange(update.key, version, false);
    return ContentiaTask.succeed(updated);
  }

  deleteDocument(key: string): ContentiaTask.ContentiaTask<void> {
    if (!this.published.delete(key)) {
      return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    }
    this.nextVersion();
    this.logChange(key, undefined, true);
    return ContentiaTask.succeed(undefined);
  }

  unpublish(key: string, status: string): ContentiaTask.ContentiaTask<Unpublished> {
    const doc = this.published.get(key);
    if (!doc) return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    this.published.delete(key);
    const version = this.nextVersion();
    const draft: Unpublished = {
      key,
      type: 'unpublished',
      status,
      language: doc.language,
      content: doc.content,
      version,
      createdAt: doc.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.unpublished.set(key, draft);
    this.logChange(key, version, false);
    return ContentiaTask.succeed(draft);
  }

  // ===== UNPUBLISHED =====

  getUnpublished(key: string): ContentiaTask.ContentiaTask<Unpublished> {
    const draft = this.unpublished.get(key);
    if (!draft) return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    return ContentiaTask.succeed(draft);
  }

  createUnpublished(create: UnpublishedCreate): ContentiaTask.ContentiaTask<Unpublished> {
    if (this.unpublished.has(create.key)) {
      return ContentiaTask.fail(new EntryAlreadyExistsError(`Already exists: ${create.key}`));
    }
    const now = new Date().toISOString();
    const version = this.nextVersion();
    const draft: Unpublished = {
      key: create.key,
      type: 'unpublished',
      status: create.status,
      language: create.language,
      content: create.content,
      version,
      createdAt: now,
      updatedAt: now,
    };
    this.unpublished.set(create.key, draft);
    this.logChange(create.key, version, false);
    return ContentiaTask.succeed(draft);
  }

  updateUnpublished(update: UnpublishedUpdate): ContentiaTask.ContentiaTask<Unpublished> {
    const existing = this.unpublished.get(update.key);
    if (!existing) return ContentiaTask.fail(new NotFoundError(`Not found: ${update.key}`));
    const version = this.nextVersion();
    const updated: Unpublished = {
      ...existing,
      status: update.status ?? existing.status,
      language: update.language ?? existing.language,
      content: update.content ?? existing.content,
      version,
      updatedAt: new Date().toISOString(),
    };
    this.unpublished.set(update.key, updated);
    this.logChange(update.key, version, false);
    return ContentiaTask.succeed(updated);
  }

  deleteUnpublished(key: string): ContentiaTask.ContentiaTask<void> {
    if (!this.unpublished.delete(key)) {
      return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    }
    this.nextVersion();
    this.logChange(key, undefined, true);
    return ContentiaTask.succeed(undefined);
  }

  publish(key: string): ContentiaTask.ContentiaTask<Document> {
    const draft = this.unpublished.get(key);
    if (!draft) return ContentiaTask.fail(new NotFoundError(`Not found: ${key}`));
    this.unpublished.delete(key);
    const version = this.nextVersion();
    const doc: Document = {
      key,
      type: 'published',
      status: 'published',
      language: draft.language,
      content: draft.content,
      version,
      createdAt: draft.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.published.set(key, doc);
    this.logChange(key, version, false);
    return ContentiaTask.succeed(doc);
  }

  // ===== RECORDS =====

  private inFolder(key: string, folder: string, depth: number): boolean {
    const prefix = folder ? (folder.endsWith('/') ? folder : `${folder}/`) : '';
    if (prefix && !key.startsWith(prefix)) return false;
    const maxDepth = (folder ? folder.split('/').length : 0) + depth;
    return key.split('/').length <= maxDepth;
  }

  /** Distinct top-level folder names (first path segment) across all stored keys. */
  private topLevelFolderNames(): string[] {
    const names = new Set<string>();
    for (const doc of this.published.values()) {
      const seg = doc.key.split('/')[0];
      if (seg) names.add(seg);
    }
    for (const draft of this.unpublished.values()) {
      const seg = draft.key.split('/')[0];
      if (seg) names.add(seg);
    }
    return [...names].sort();
  }

  listRecords(options: ListRecordsOptions): ContentiaStream.ContentiaStream<Record, ListRecordsDone> {
    // Root listing (no/empty folder): each collection is a folder entry,
    // matching `CatalogDocumentsRepository`.
    if (!options.folder) {
      const folders: Record[] = this.topLevelFolderNames().map(key => ({ type: 'folder', key }));
      const total = folders.length;
      const page = applyPagination(folders, options.pagination);
      return page.length > 0 ? ContentiaStream.succeedMany(page, { total }) : ContentiaStream.empty({ total });
    }

    const all: Record[] = [];
    if (options.type === 'published' || options.type === undefined) {
      for (const doc of this.published.values()) {
        if (this.inFolder(doc.key, options.folder, options.depth)) all.push(doc);
      }
    }
    if (options.type === 'unpublished' || options.type === undefined) {
      for (const draft of this.unpublished.values()) {
        if (!this.inFolder(draft.key, options.folder, options.depth)) continue;
        if (options.statuses && !options.statuses.includes(draft.status)) continue;
        all.push(draft);
      }
    }
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const total = all.length;
    const page = applyPagination(all, options.pagination);
    return page.length > 0
      ? ContentiaStream.succeedMany(page, { total })
      : ContentiaStream.empty({ total });
  }

  listRecordSummaries(
    options: ListRecordsOptions,
  ): ContentiaStream.ContentiaStream<RecordSummary, ListRecordsDone> {
    if (!options.folder) {
      const folders: RecordSummary[] = this.topLevelFolderNames().map(key => ({ type: 'folder-summary', key }));
      const total = folders.length;
      const page = applyPagination(folders, options.pagination);
      return page.length > 0 ? ContentiaStream.succeedMany(page, { total }) : ContentiaStream.empty({ total });
    }

    const all: RecordSummary[] = [];
    if (options.type === 'published' || options.type === undefined) {
      for (const doc of this.published.values()) {
        if (!this.inFolder(doc.key, options.folder, options.depth)) continue;
        all.push({
          key: doc.key,
          type: 'published-summary',
          status: 'published',
          language: doc.language,
          ...(doc.version !== undefined ? { version: doc.version } : {}),
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        });
      }
    }
    if (options.type === 'unpublished' || options.type === undefined) {
      for (const draft of this.unpublished.values()) {
        if (!this.inFolder(draft.key, options.folder, options.depth)) continue;
        if (options.statuses && !options.statuses.includes(draft.status)) continue;
        all.push({
          key: draft.key,
          type: 'unpublished-summary',
          status: draft.status,
          language: draft.language,
          ...(draft.version !== undefined ? { version: draft.version } : {}),
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt,
        });
      }
    }
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const total = all.length;
    const page = applyPagination(all, options.pagination);
    return page.length > 0
      ? ContentiaStream.succeedMany(page, { total })
      : ContentiaStream.empty({ total });
  }

  // ===== REVISIONS =====

  getRevision(key: string, revision: string): ContentiaTask.ContentiaTask<Revision> {
    const rev = this.revisions.get(key)?.get(revision);
    if (!rev) return ContentiaTask.fail(new NotFoundError(`Revision not found: ${key}@${revision}`));
    return ContentiaTask.succeed(rev);
  }

  createRevision(create: RevisionCreate): ContentiaTask.ContentiaTask<Revision> {
    const now = new Date().toISOString();
    const rev: Revision = {
      key: create.key,
      type: 'revision',
      revision: create.revision,
      language: create.language,
      content: create.content,
      createdAt: now,
      updatedAt: now,
    };
    const perKey = this.revisions.get(create.key) ?? new Map<string, Revision>();
    perKey.set(create.revision, rev);
    this.revisions.set(create.key, perKey);
    return ContentiaTask.succeed(rev);
  }

  listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): ContentiaStream.ContentiaStream<RevisionSummary, ListRevisionsDone> {
    const perKey = this.revisions.get(key);
    const all: RevisionSummary[] = perKey
      ? [...perKey.values()].map(rev => ({
        key: rev.key,
        type: 'revision-summary' as const,
        revision: rev.revision,
        language: rev.language,
        createdAt: rev.createdAt,
        updatedAt: rev.updatedAt,
      }))
      : [];
    const total = all.length;
    const page = applyPagination(all, options.pagination);
    return page.length > 0
      ? ContentiaStream.succeedMany(page, { total })
      : ContentiaStream.empty({ total });
  }

  // ===== CHANGE SIGNALS =====

  override getSyncToken(options?: GetSyncTokenOptions): ContentiaTask.ContentiaTask<SyncToken> {
    if (!options?.folder) return ContentiaTask.succeed(this.currentToken());
    // Scope the token to the folder: the highest sequence number of any
    // change under it. The whole-store token remains valid as a scope token
    // too, but the folder-scoped token only moves when the folder does.
    let latest = 0;
    for (const entry of this.changeLog) {
      if (this.inFolder(entry.key, options.folder, Number.MAX_SAFE_INTEGER)) latest = entry.seq;
    }
    return ContentiaTask.succeed(SyncToken.make(String(latest)));
  }

  override listChanges(
    options: ListChangesOptions,
  ): ContentiaStream.ContentiaStream<ChangeSummary, ListChangesDone> {
    const since = Number.parseInt(options.since, 10);
    if (Number.isNaN(since)) {
      return ContentiaStream.fail(new InvalidData(`Unrecognized sync token: ${options.since}`));
    }
    // Collapse the log to the latest state per key so callers see one entry
    // per changed record.
    const byKey = new Map<string, ChangeSummary>();
    for (const entry of this.changeLog) {
      if (entry.seq <= since) continue;
      if (options.folder && !this.inFolder(entry.key, options.folder, Number.MAX_SAFE_INTEGER)) continue;
      byKey.set(entry.key, {
        key: entry.key,
        ...(entry.version !== undefined ? { version: entry.version } : {}),
        deleted: entry.deleted,
      });
    }
    const changes = [...byKey.values()];
    const done: ListChangesDone = { syncToken: this.currentToken(), total: changes.length };
    return changes.length > 0
      ? ContentiaStream.succeedMany(changes, done)
      : ContentiaStream.empty(done);
  }
}
