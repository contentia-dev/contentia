import type { LaikaError } from 'laikacms/core';
import { LaikaStream } from 'laikacms/core';
import type { DocumentsRepository } from 'laikacms/documents';
import type { StorageRepository } from 'laikacms/storage';

export const PAGE_SIZE = 100;

/** One row in an explorer tree, independent of how VS Code renders it. */
export type Entry =
  | { readonly kind: 'folder', readonly key: string, readonly label: string }
  | { readonly kind: 'object', readonly key: string, readonly label: string, readonly updatedAt?: string }
  | {
    readonly kind: 'record',
    readonly key: string,
    readonly label: string,
    /** `published`, or the unpublished status (`draft`, `pending_review`, ...). */
    readonly status: string,
    readonly published: boolean,
    readonly language: string,
    readonly updatedAt?: string,
  };

export interface Page {
  readonly entries: readonly Entry[];
  /** The page to request next, or `undefined` when this was the last one. */
  readonly nextPage: number | undefined;
  /** Recoverable warnings the repository reported while listing. */
  readonly warnings: readonly LaikaError[];
}

/** The last key segment: `posts/2026/hello` shows as `hello`. */
export const labelOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1) || key;

/**
 * Page-based listing never says "no more" outright, so infer it: from `total`
 * when the backend reports one, otherwise from a short page.
 */
const nextPageOf = (page: number, received: number, total: number | undefined): number | undefined => {
  if (total !== undefined) return page * PAGE_SIZE < total ? page + 1 : undefined;
  return received < PAGE_SIZE ? undefined : page + 1;
};

const sortEntries = (entries: Entry[]): Entry[] =>
  entries.sort((a, b) => {
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

/** List one page of a storage folder's direct children (`''` is the root). */
export const listStorageFolder = async (
  repository: StorageRepository,
  folderKey: string,
  page: number,
): Promise<Page> => {
  const { data, done, recoverableErrors } = await LaikaStream.runPromiseCollect(
    repository.listAtomSummaries(folderKey, { depth: 1, pagination: { page, perPage: PAGE_SIZE } }),
  );
  const entries = data.map((atom): Entry =>
    atom.type === 'folder-summary'
      ? { kind: 'folder', key: atom.key, label: labelOf(atom.key) }
      : { kind: 'object', key: atom.key, label: labelOf(atom.key), updatedAt: atom.updatedAt }
  );
  return {
    entries: sortEntries(entries),
    nextPage: nextPageOf(page, data.length, done.total),
    warnings: recoverableErrors,
  };
};

/**
 * List one page of a documents folder. `undefined` lists the root, where the
 * repository returns each collection as a folder.
 */
export const listDocumentsFolder = async (
  repository: DocumentsRepository,
  folder: string | undefined,
  page: number,
): Promise<Page> => {
  const { data, done, recoverableErrors } = await LaikaStream.runPromiseCollect(
    repository.listRecordSummaries({ folder, depth: 1, pagination: { page, perPage: PAGE_SIZE } }),
  );
  const entries = data.map((record): Entry => {
    if (record.type === 'folder-summary') return { kind: 'folder', key: record.key, label: labelOf(record.key) };
    return {
      kind: 'record',
      key: record.key,
      label: labelOf(record.key),
      status: record.status,
      published: record.type === 'published-summary',
      language: record.language,
      updatedAt: record.updatedAt,
    };
  });
  return {
    entries: sortEntries(entries),
    nextPage: nextPageOf(page, data.length, done.total),
    warnings: recoverableErrors,
  };
};
