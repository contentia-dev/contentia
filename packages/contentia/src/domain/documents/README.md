# contentia/documents

[![npm](https://img.shields.io/npm/v/contentia)](https://www.npmjs.com/package/contentia)
[![npm](https://img.shields.io/npm/dm/contentia)](https://www.npmjs.com/package/contentia)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/contentia)](https://bundlephobia.com/result?p=contentia)

Document management with editorial workflow support.

## Installation

```bash
pnpm add contentia
```

## Usage

```typescript
import { Document, DocumentsRepository, Unpublished } from 'contentia/documents';
```

## Entities

- `Document` - Published document
- `Unpublished` - Draft/pending document
- `Revision` - Document revision history

## Capabilities

`getCapabilities()` returns a `DocumentsCapabilities` object with four fields:

| Field               | Description                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compatibilityDate` | Opaque version string — implementations increment this when they change behavior in a breaking way.                                                                                                                      |
| `pagination`        | Which pagination styles (`offset`, `page`, `cursor`) the repository honors on listing calls. `supported: false` means pagination is ignored and full lists are always returned.                                          |
| `versionTracking`   | Whether the repository attaches an opaque per-record `version` token to returned documents, unpublished records, and summaries. Tokens change only when content changes; compare by equality.                            |
| `changes`           | Whether `getSyncToken` and `listChanges` are implemented. `syncToken: true` means `getSyncToken` works; `changeFeed: true` means `listChanges` works. Both default to `false` (methods fail with `NotImplementedError`). |

## Editorial Workflow

```
Draft → Pending Review → Pending Publish → Published
```

## Repository Interface

```typescript
abstract class DocumentsRepository {
  abstract getCapabilities(): ContentiaTask.ContentiaTask<DocumentsCapabilities>;

  // Records (all states)
  abstract listRecords(
    options: ListRecordsOptions,
  ): ContentiaStream.ContentiaStream<Record, ListRecordsDone>;
  abstract listRecordSummaries(
    options: ListRecordSummaries,
  ): ContentiaStream.ContentiaStream<RecordSummary, ListRecordsDone>;

  // Documents (published)
  abstract getDocument(key: Key): ContentiaTask.ContentiaTask<Document>;
  abstract createDocument(create: DocumentCreate): ContentiaTask.ContentiaTask<Document>;
  abstract updateDocument(update: DocumentUpdate): ContentiaTask.ContentiaTask<Document>;
  abstract deleteDocument(key: Key): ContentiaTask.ContentiaTask<void>;
  abstract unpublish(key: Key, status: string): ContentiaTask.ContentiaTask<Unpublished>;

  // Unpublished documents (draft, pending_review, archived, trash, …)
  abstract getUnpublished(key: Key): ContentiaTask.ContentiaTask<Unpublished>;
  abstract createUnpublished(create: UnpublishedCreate): ContentiaTask.ContentiaTask<Unpublished>;
  abstract updateUnpublished(update: UnpublishedUpdate): ContentiaTask.ContentiaTask<Unpublished>;
  abstract deleteUnpublished(key: Key): ContentiaTask.ContentiaTask<void>;
  abstract publish(key: Key): ContentiaTask.ContentiaTask<Document>;

  // Revisions (version history)
  abstract getRevision(key: Key, revision: string): ContentiaTask.ContentiaTask<Revision>;
  abstract createRevision(create: RevisionCreate): ContentiaTask.ContentiaTask<Revision>;
  abstract listRevisions(
    key: Key,
    options: ListRevisionsOptions,
  ): ContentiaStream.ContentiaStream<RevisionSummary, ListRevisionsDone>;

  // Change signals (capability-gated; check getCapabilities().changes before calling)
  getSyncToken(options?: GetSyncTokenOptions): ContentiaTask.ContentiaTask<SyncToken>;
  listChanges(
    options: ListChangesOptions,
  ): ContentiaStream.ContentiaStream<ChangeSummary, ListChangesDone>;
}
```

`ContentiaTask.ContentiaTask<T>` resolves to a single value (like a Promise).
`ContentiaStream.ContentiaStream<T, Done>` emits multiple values then a done value. Both come from
`contentia/core`. `Key` comes from `contentia/storage`. `ListRecordsDone` and `ListRevisionsDone`
are type aliases for `ContentiaDone` (carries pagination and total).

## Implementations

- `contentia/documents/drizzle` - SQL via Drizzle ORM
- `contentia/documents/catalog` - Catalog storage
- `contentia/documents/jsonapi-proxy` - JSON:API proxy (remote repository over HTTP)
- `contentia/documents/obsidian` - Obsidian vault (published state via frontmatter)
