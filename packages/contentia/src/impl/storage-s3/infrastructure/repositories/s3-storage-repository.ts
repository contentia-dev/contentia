import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  type ContentiaError,
  type ContentiaResult,
  ContentiaStream,
  ContentiaTask,
  EntryAlreadyExistsError,
  InvalidData,
  NotFoundError,
} from 'contentia/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageSerializerRegistry,
} from 'contentia/storage';
import {
  applyPagination,
  Capabilities,
  CompatibilityDate,
  compileIgnoreList,
  defaultDetermineExtension,
  type DetermineExtension,
  type IgnoreMatcher,
  naturalCompare,
  StorageRepository,
  unsupportedChanges,
} from 'contentia/storage';

import type { S3Entry } from '../../domain/entities/s3-entry.js';
import type { S3Config } from '../datasources/s3-client.js';
import { S3DataSource, type S3ObjectWithContent } from '../datasources/s3-datasource.js';

const liftResult = <A>(p: Promise<ContentiaResult<A>>): Effect.Effect<A, ContentiaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.catalog',
  '**/.contentia',
];

/**
 * A `StorageRepository` on any S3-compatible object store: AWS S3, MinIO,
 * Backblaze B2, DigitalOcean Spaces, Cloudflare R2 over its S3 endpoint, …
 *
 * S3 is a flat key space, so folders are key prefixes, empty folders hold a
 * `.keep` marker, and objects are stored as `<key>.<extension>` with the
 * extension picked from the serializer registry. `createdAt` is kept in the
 * `contentia-created-at` user metadata because S3 resets `LastModified` on
 * every write.
 *
 * The AWS SDK is not a dependency: pass your own `S3Client` and the command
 * classes from `@aws-sdk/client-s3` in `config`.
 */
export class S3StorageRepository extends StorageRepository {
  private readonly dataSource: S3DataSource;
  private readonly isIgnored: IgnoreMatcher;

  constructor(
    config: S3Config,
    private readonly serializerRegistry: StorageSerializerRegistry,
    private readonly defaultFileExtension: string,
    ignoreList: readonly string[] = DEFAULT_IGNORE_LIST,
    private readonly determineExtension: DetermineExtension = defaultDetermineExtension,
  ) {
    super();
    if (defaultFileExtension.startsWith('.')) this.defaultFileExtension = defaultFileExtension.slice(1);
    this.dataSource = new S3DataSource(config, Object.keys(serializerRegistry));
    this.isIgnored = compileIgnoreList(ignoreList);
  }

  private serializerFor(extension: string): Effect.Effect<StorageSerializerRegistry[string], ContentiaError> {
    const serializer = this.serializerRegistry[extension];
    if (serializer) return Effect.succeed(serializer);
    return Effect.fail(
      new BadRequestError(
        `No serializer found for file extension: .${extension}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
        { translation: { message: 'storage.s3.invalidRequest' } },
      ),
    );
  }

  private serialize(extension: string, content: StorageObjectContent): Effect.Effect<string, ContentiaError> {
    return Effect.flatMap(this.serializerFor(extension), serializer =>
      Effect.tryPromise({
        try: () => serializer.serializeDocumentFileContents(content, {}),
        catch: error =>
          new BadRequestError(
            `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`,
            { translation: { message: 'storage.s3.invalidRequest' } },
          ),
      }));
  }

  private toStorageObject(object: S3ObjectWithContent): Effect.Effect<StorageObject, ContentiaError> {
    return Effect.flatMap(this.serializerFor(object.extension), serializer =>
      Effect.tryPromise({
        try: () => serializer.deserializeDocumentFileContents(object.content, {}),
        catch: error =>
          new BadRequestError(
            `Failed to deserialize ${object.key}: ${error instanceof Error ? error.message : String(error)}`,
            { translation: { message: 'storage.s3.invalidRequest' } },
          ),
      }).pipe(
        Effect.map((content): StorageObject => ({
          type: 'object',
          key: object.key,
          createdAt: object.createdAt.toISOString(),
          updatedAt: object.updatedAt.toISOString(),
          content,
          metadata: { extension: object.extension },
        })),
      ));
  }

  getObject(key: string): ContentiaTask.ContentiaTask<StorageObject> {
    return ContentiaTask.make<StorageObject>(() =>
      Effect.flatMap(liftResult(this.dataSource.readObject(key)), object => this.toStorageObject(object))
    );
  }

  getFolder(key: string): ContentiaTask.ContentiaTask<Folder> {
    return ContentiaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* liftResult(this.dataSource.folderExists(key));
        if (!exists) {
          return yield* Effect.fail(
            new NotFoundError(`Folder at ${key} does not exist`, {
              translation: { message: 'storage.s3.directoryNotFound' },
            }),
          );
        }
        // S3 prefixes carry no timestamps of their own.
        const now = new Date().toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): ContentiaTask.ContentiaTask<Atom> {
    return ContentiaTask.make<Atom>(emit =>
      Effect.gen({ self: this }, function*() {
        const object = yield* liftResult(this.dataSource.findObject(key));
        if (object) return yield* ContentiaTask.runValueForwarding(this.getObject(key), emit);
        const isFolder = yield* liftResult(this.dataSource.folderExists(key));
        if (isFolder) return yield* ContentiaTask.runValueForwarding(this.getFolder(key), emit);
        return yield* Effect.fail(
          new NotFoundError(`Nothing exists at ${key}`, {
            translation: { message: 'storage.s3.fileNotFound' },
          }),
        );
      })
    );
  }

  createObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject> {
    return ContentiaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(
            new InvalidData('Object content is required for creation', {
              translation: { message: 'storage.s3.contentRequired' },
            }),
          );
        }
        const existing = yield* liftResult(this.dataSource.findObject(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
              { translation: { message: 'storage.s3.entryAlreadyExists' } },
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const body = yield* this.serialize(extension, create.content);
        yield* liftResult(this.dataSource.putObject(create.key, extension, body, new Date()));
        return yield* this.readbackOrSynthesize(create, extension, emit);
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject> {
    return ContentiaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.dataSource.findObject(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const body = create.content ? yield* this.serialize(extension, create.content) : '';
        const createdAt = existing?.createdAt ?? new Date();
        yield* liftResult(this.dataSource.putObject(create.key, extension, body, createdAt));
        return yield* this.readbackOrSynthesize(create, extension, emit);
      })
    );
  }

  updateObject(update: StorageObjectUpdate): ContentiaTask.ContentiaTask<StorageObject> {
    return ContentiaTask.make<StorageObject>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.dataSource.headObject(update.key));
        if (update.content) {
          const body = yield* this.serialize(existing.extension, update.content);
          yield* liftResult(this.dataSource.putObject(update.key, existing.extension, body, existing.createdAt));
        }
        return yield* ContentiaTask.runValueForwarding(this.getObject(update.key), emit);
      })
    );
  }

  /**
   * Return the stored object after a successful write. S3 is strongly
   * read-after-write consistent, but S3-compatible stores aren't all; if the
   * readback misses, emit it as a recoverable warning and build the result
   * from what was just written instead of failing a write that succeeded.
   */
  private readbackOrSynthesize(
    create: StorageObjectCreate,
    extension: string,
    emit: ContentiaTask.ContentiaTaskEmit,
  ): Effect.Effect<StorageObject, ContentiaError> {
    return Effect.gen({ self: this }, function*() {
      const readback = yield* Effect.result(ContentiaTask.runValueForwarding(this.getObject(create.key), emit));
      if (readback._tag === 'Success') return readback.success;
      yield* emit.recoverableError(readback.failure);
      const now = new Date().toISOString();
      return {
        type: 'object' as const,
        key: create.key,
        createdAt: now,
        updatedAt: now,
        content: create.content ?? {},
        metadata: { extension },
      } satisfies StorageObject;
    });
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder> {
    return ContentiaTask.make<Folder>(emit =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.putFolderMarker(folderCreate.key));
        return yield* ContentiaTask.runValueForwarding(this.getFolder(folderCreate.key), emit);
      })
    );
  }

  removeAtoms(keys: readonly string[]): ContentiaStream.ContentiaStream<string, RemoveAtomsDone> {
    return ContentiaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const result = yield* Effect.promise(() => this.dataSource.deleteObject(key));
          if (Result.isFailure(result)) {
            yield* emit.recoverableError(result.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(result.success);
          removed += 1;
        }
        return { removed, skipped };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<AtomSummary, ListAtomsDone> {
    return ContentiaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, total, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total };
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<Atom, ListAtomsDone> {
    return ContentiaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, total, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        for (const summary of summaries) {
          const task: ContentiaTask.ContentiaTask<Atom> = summary.type === 'object-summary'
            ? this.getObject(summary.key)
            : this.getFolder(summary.key);
          const atom = yield* Effect.result(ContentiaTask.runValueForwarding(task, emit));
          if (Result.isFailure(atom)) yield* emit.recoverableError(atom.failure);
          else yield* emit.data(atom.success);
        }
        return { total };
      })
    );
  }

  /**
   * Walk `folderKey` up to `maxDepth` levels deep (1 = direct children). A
   * missing root folder comes back as `missingFolder` so listings can warn
   * instead of failing; a subfolder that vanishes mid-walk is skipped.
   */
  private collectEntries(
    folderKey: string,
    maxDepth: number,
  ): Effect.Effect<{ entries: S3Entry[], missingFolder?: ContentiaError }, ContentiaError> {
    return Effect.gen({ self: this }, function*() {
      const walk = (key: string, depth: number): Effect.Effect<S3Entry[], ContentiaError> =>
        Effect.gen({ self: this }, function*() {
          const listed = yield* liftResult(this.dataSource.listDirectory(key));
          const entries: S3Entry[] = [];
          for (const entry of listed) {
            entries.push(entry);
            if (entry.type === 'dir' && depth < maxDepth) {
              const children = yield* Effect.result(walk(entry.key, depth + 1));
              if (Result.isSuccess(children)) entries.push(...children.success);
            }
          }
          return entries;
        });

      const root = yield* Effect.result(walk(folderKey, 1));
      if (Result.isSuccess(root)) return { entries: root.success };
      if (root.failure instanceof NotFoundError) return { entries: [], missingFolder: root.failure };
      return yield* Effect.fail(root.failure);
    });
  }

  private collectSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<
    { summaries: ReadonlyArray<AtomSummary>, total: number, missingFolder?: ContentiaError },
    ContentiaError
  > {
    return Effect.gen({ self: this }, function*() {
      const { entries, missingFolder } = yield* this.collectEntries(folderKey, options.depth);
      if (missingFolder) return { summaries: [], total: 0, missingFolder };
      const summaries = entries
        .filter(entry => !this.isIgnored(entry.key))
        .map((entry): AtomSummary =>
          entry.type === 'file'
            ? { type: 'object-summary', key: this.dataSource.stripExtension(entry.key) }
            : { type: 'folder-summary', key: entry.key }
        )
        .sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(summaries, options.pagination), total: summaries.length };
    });
  }

  getCapabilities(): ContentiaTask.ContentiaTask<Capabilities> {
    return ContentiaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-11-02'),
      fileExtensions: {
        supported: true,
        supportedExtensions: this.serializerRegistry,
        description: 'Supported file types depend on the serializers provided to this repository.',
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over object listings; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
    });
  }
}
