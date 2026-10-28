import type { ContentiaDone, ContentiaStream, ContentiaTask, Pagination } from 'contentia/core';
import { NotImplementedError } from 'contentia/core';

import type { Capabilities } from '../entities/capabilities.js';
import type {
  Atom,
  AtomSummary,
  ChangeListener,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  SubscribeChangesOptions,
  Unsubscribe,
} from '../entities/index.js';
import type { Key } from '../types/key.js';

export interface ListAtomsOptions {
  depth: number;
  pagination: Pagination;
}

/**
 * Done value returned by `listAtoms` / `listAtomSummaries`. Pagination on the
 * base lets HTTP layers wire JSON:API `links.next` / `meta.total` without
 * per-method special cases.
 */
export type ListAtomsDone = ContentiaDone;

/**
 * Done value returned by `removeAtoms`. Per-key removal failures are surfaced
 * as stream warnings (typically NotFoundError); the done value reports counts.
 */
export interface RemoveAtomsDone extends ContentiaDone {
  readonly removed: number;
  readonly skipped: number;
}

export abstract class StorageRepository {
  // Storage Objects (formerly Files)
  abstract getObject(key: Key): ContentiaTask.ContentiaTask<StorageObject>;
  abstract updateObject(update: StorageObjectUpdate): ContentiaTask.ContentiaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject>;
  abstract createOrUpdateObject(create: StorageObjectCreate): ContentiaTask.ContentiaTask<StorageObject>;

  // Folders (formerly Directories)
  abstract getFolder(key: Key): ContentiaTask.ContentiaTask<Folder>;
  abstract listAtomSummaries(
    folderKey: Key,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<AtomSummary, ListAtomsDone>;
  abstract listAtoms(
    folderKey: Key,
    options: ListAtomsOptions,
  ): ContentiaStream.ContentiaStream<Atom, ListAtomsDone>;
  abstract createFolder(folderCreate: FolderCreate): ContentiaTask.ContentiaTask<Folder>;

  // Atoms (formerly Entries)
  abstract getAtom(key: Key): ContentiaTask.ContentiaTask<Atom>;
  abstract removeAtoms(keys: readonly Key[]): ContentiaStream.ContentiaStream<Key, RemoveAtomsDone>;

  // Other
  abstract getCapabilities(): ContentiaTask.ContentiaTask<Capabilities>;

  // Change signals (capability-gated; see Capabilities.changes)

  /**
   * Subscribe to live change notifications for a scope (a folder, or the whole
   * store when omitted). `listener` is invoked with a coalesced, non-empty
   * batch of {@link ChangeSummary} entries each time the scope changes. Returns
   * an {@link Unsubscribe} that stops delivery; when the last listener leaves,
   * the repository releases any underlying watch resource.
   *
   * This is the PUSH counterpart to the pull `getSyncToken` / `listChanges`
   * feed. Non-abstract on purpose: existing subclasses stay source-compatible.
   * The base implementation throws `NotImplementedError`; check
   * `getCapabilities().changes` (the enabled variant's `subscription` flag)
   * before calling.
   */
  subscribeChanges(options: SubscribeChangesOptions, listener: ChangeListener): Unsubscribe {
    void options;
    void listener;
    throw new NotImplementedError(
      'subscribeChanges is not supported by this storage repository. '
        + 'Consult getCapabilities().changes.subscription before calling.',
    );
  }
}
