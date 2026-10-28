import * as Effect from 'effect/Effect';

import { isData } from './contentia-element.js';
import * as ContentiaStream from './contentia-stream.js';
import * as ContentiaTask from './contentia-task.js';
import type { ContentiaDone, ContentiaMetadata } from './contentia-types.js';

export interface CompatOptions {
  readonly onProgress?: (metadata: ContentiaMetadata) => void;
}

/**
 * Run a {@link ContentiaTask} to completion and return its value as a Promise.
 * Rejects with the fatal {@link ContentiaError} on failure.
 *
 * Pass `onProgress` to receive each {@link ContentiaMetadata} event (progress +
 * recoverable errors) as the task runs.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const runTask = <A>(task: ContentiaTask.ContentiaTask<A>, options?: CompatOptions): Promise<A> => {
  const { onProgress } = options ?? {};
  if (!onProgress) return ContentiaTask.runPromise(task);
  return Effect.runPromise(
    ContentiaTask.drainWithValue(task, chunk => {
      for (const meta of chunk) onProgress(meta);
      return Effect.void;
    }),
  );
};

/**
 * Collect all data items from a {@link ContentiaStream} into an array and return
 * `{ items, done }` as a Promise. Rejects with the fatal {@link ContentiaError}
 * on failure.
 *
 * Pass `onProgress` to receive each {@link ContentiaMetadata} event (progress +
 * recoverable errors) as the stream runs. Data elements are NOT forwarded to
 * the callback — they are collected into `items` as usual.
 *
 * This is a Promise-friendly entry point that does not require importing
 * `effect` at the call site.
 */
export const collectStream = async <A, D extends ContentiaDone>(
  stream: ContentiaStream.ContentiaStream<A, D>,
  options?: CompatOptions,
): Promise<{ items: ReadonlyArray<A>, done: D }> => {
  const { onProgress } = options ?? {};
  if (!onProgress) {
    const items: A[] = [];
    const done = await Effect.runPromise(
      ContentiaStream.drainWithDone(stream, chunk => {
        for (const el of chunk) {
          if (isData(el)) items.push(el.value);
        }
        return Effect.void;
      }),
    );
    return { items, done };
  }
  const items: A[] = [];
  const done = await Effect.runPromise(
    ContentiaStream.drainWithDone(stream, chunk => {
      for (const el of chunk) {
        if (isData(el)) items.push(el.value);
        else onProgress(el);
      }
      return Effect.void;
    }),
  );
  return { items, done };
};
