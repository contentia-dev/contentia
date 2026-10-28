import type { ContentiaError } from 'contentia/core';

import type { ContentiaMetadata, ContentiaProgress } from './contentia-types.js';

/**
 * Elements carried in a {@link ContentiaStream.ContentiaStream}'s output channel:
 * metadata plus data values.
 */
export type ContentiaElement<A> =
  | ContentiaMetadata
  | { readonly _tag: 'Data', readonly value: A };

const dataTag = 'Data' as const;
const recoverableErrorTag = 'RecoverableError' as const;
const progressTag = 'Progress' as const;

export const data = <A>(value: A): ContentiaElement<A> => ({ _tag: dataTag, value });

export const recoverableError = (error: ContentiaError): ContentiaElement<never> => ({
  _tag: recoverableErrorTag,
  error,
});

export const progress = (progress: ContentiaProgress): ContentiaElement<never> => ({
  _tag: progressTag,
  progress,
});

export const isData = <A>(
  el: ContentiaElement<A>,
): el is { readonly _tag: 'Data', readonly value: A } => el._tag === dataTag;

export const isRecoverableError = <A>(
  el: ContentiaElement<A>,
): el is { readonly _tag: 'RecoverableError', readonly error: ContentiaError } => el._tag === recoverableErrorTag;

export const isProgress = <A>(
  el: ContentiaElement<A>,
): el is { readonly _tag: 'Progress', readonly progress: ContentiaProgress } => el._tag === progressTag;
