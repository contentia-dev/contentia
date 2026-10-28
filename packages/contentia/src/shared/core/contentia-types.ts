import type * as Arr from 'effect/Array';

import type { ContentiaError } from 'contentia/core';

import type { Pagination } from './domain/types/pagination.js';

/**
 * Base shape for a {@link ContentiaStream.ContentiaStream}'s terminal OutDone — the
 * "closing return value" emitted after the stream's elements. Methods extend
 * it with their own typed fields.
 *
 * `pagination` matches the `Pagination` request shape: the value describes
 * how to fetch the NEXT page (omitted when there is no next page).
 */
export interface ContentiaDone {
  readonly pagination?: Pagination;
  readonly total?: number;
}

/**
 * Progress event. All fields optional so callers may emit partial updates.
 */
export interface ContentiaProgress {
  readonly stage?: string;
  readonly current?: number;
  readonly total?: number;
  readonly message?: string;
}

/**
 * Metadata events. Same shape for {@link ContentiaStream.ContentiaStream} and
 * {@link ContentiaTask.ContentiaTask} — "recoverable error" and "progress update"
 * are channel positions, not types.
 */
export type ContentiaMetadata =
  | { readonly _tag: 'RecoverableError', readonly error: ContentiaError }
  | { readonly _tag: 'Progress', readonly progress: ContentiaProgress };

/**
 * Non-empty chunks (Effect chunks are non-empty by construction).
 */
export type ContentiaMetadataChunk = Arr.NonEmptyReadonlyArray<ContentiaMetadata>;
