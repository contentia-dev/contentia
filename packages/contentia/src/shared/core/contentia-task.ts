import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Queue from 'effect/Queue';
import * as Result from 'effect/Result';
import type * as Scope from 'effect/Scope';

import type { ContentiaError } from 'contentia/core';

import { attachAsyncIterator } from './contentia-iterator.js';
import type { ContentiaMetadata, ContentiaMetadataChunk, ContentiaProgress } from './contentia-types.js';

/**
 * `ContentiaTask<A, R>` — a single-result sibling to {@link ContentiaStream.ContentiaStream}.
 *
 *   • metadata   — many progress events + recoverable errors, interleaved
 *   • result     — exactly ONE `A` at the end (Channel's OutDone) — the result
 *                  IS the data; no separate done value
 *
 * Fatal errors are `ContentiaError` raised through the Channel's OutErr; they
 * terminate the task without yielding a value. Use ContentiaTask for operations
 * that return one item (`getObject`, `createFolder`, etc.); use ContentiaStream
 * for operations that return many.
 */
export interface ContentiaTask<A, R = never>
  extends
    Channel.Channel<ContentiaMetadataChunk, ContentiaError, A, unknown, unknown, unknown, R>,
    AsyncIterable<ContentiaMetadataChunk, A>
{}

const recoverableErrorTag = 'RecoverableError' as const;
const progressTag = 'Progress' as const;

const recoverableErrorMetadata = (error: ContentiaError): ContentiaMetadata => ({
  _tag: recoverableErrorTag,
  error,
});
const progressMetadata = (progress: ContentiaProgress): ContentiaMetadata => ({
  _tag: progressTag,
  progress,
});

/** Emits no metadata; immediately resolves to the value. */
export const succeed = <A>(value: A): ContentiaTask<A> =>
  attachAsyncIterator(Channel.end(value)) as unknown as ContentiaTask<A>;

/** Fails fatally without yielding a value. */
export const fail = (error: ContentiaError): ContentiaTask<never> =>
  attachAsyncIterator(Channel.fail(error)) as unknown as ContentiaTask<never>;

/** Lift an Effect producing a value (and optional recoverable errors) into a ContentiaTask. */
export const fromEffect = <A, R = never>(
  eff: Effect.Effect<
    { readonly value: A, readonly recoverableErrors?: ReadonlyArray<ContentiaError> },
    ContentiaError,
    R
  >,
): ContentiaTask<A, R> =>
  make<A, R>(emit =>
    Effect.gen(function*() {
      const { value, recoverableErrors } = yield* eff;
      if (recoverableErrors) {
        for (const e of recoverableErrors) yield* emit.recoverableError(e);
      }
      return value;
    })
  );

/**
 * Structural shape shared by {@link ContentiaTaskEmit} and `ContentiaStreamEmit` for
 * the metadata channel (recoverable errors + progress). Helpers that forward
 * metadata between ContentiaTask and ContentiaStream accept this minimal interface
 * so either emit shape can be plugged in.
 */
export interface ContentiaMetadataEmit {
  readonly recoverableError: (error: ContentiaError) => Effect.Effect<void>;
  readonly progress: (progress: ContentiaProgress) => Effect.Effect<void>;
}

/** Emit-API exposed to a `make` builder for tasks. Metadata events only. */
export type ContentiaTaskEmit = ContentiaMetadataEmit;

/**
 * Generator-style builder for arbitrary ContentiaTasks. The builder receives a
 * metadata-only `emit` API and returns an Effect that resolves to the value
 * (which becomes the task's terminal return value).
 */
export const make = <A, R = never>(
  build: (emit: ContentiaTaskEmit) => Effect.Effect<A, ContentiaError, R>,
  options?: { readonly capacity?: number },
): ContentiaTask<A, R> => {
  const capacity = options?.capacity ?? 16;
  return attachAsyncIterator(
    Channel.fromTransform<
      ContentiaMetadataChunk,
      ContentiaError | Cause.Done<A>,
      A,
      unknown,
      unknown,
      unknown,
      never,
      R,
      R
    >((_upstream: unknown, scope: Scope.Scope) =>
      Effect.gen(function*() {
        const queue: Queue.Queue<ContentiaMetadata, ContentiaError | Cause.Done<A>> = yield* Queue.bounded<
          ContentiaMetadata,
          ContentiaError | Cause.Done<A>
        >(capacity);

        const emit: ContentiaTaskEmit = {
          recoverableError: error => Effect.asVoid(Queue.offer(queue, recoverableErrorMetadata(error))),
          progress: progress => Effect.asVoid(Queue.offer(queue, progressMetadata(progress))),
        };

        // matchCauseEffect (not matchEffect): a builder that dies with a
        // defect must still terminate the queue — otherwise the forked fiber
        // ends silently and every consumer of the task hangs forever.
        const builder = build(emit).pipe(
          Effect.matchCauseEffect({
            onSuccess: value => Queue.fail(queue, Cause.Done(value)),
            onFailure: cause => Queue.failCause(queue, cause as Cause.Cause<ContentiaError | Cause.Done<A>>),
          }),
        );
        yield* Effect.forkIn(builder, scope);

        return Queue.takeAll(queue) as never;
      })
    ),
  ) as unknown as ContentiaTask<A, R>;
};

/**
 * Drain a ContentiaTask collecting all recoverable errors and progress events, and
 * return the resolved value.
 *
 * When the caller is itself the body of a `ContentiaTask.make` (i.e. it's
 * forwarding through a delegation chain), prefer {@link runValueForwarding}
 * — it pipes the inner task's warnings into the outer task's `emit` instead
 * of leaving the caller to manually re-emit them.
 */
export const runCollect = <A, R>(
  self: ContentiaTask<A, R>,
): Effect.Effect<
  {
    readonly recoverableErrors: ReadonlyArray<ContentiaError>,
    readonly progress: ReadonlyArray<ContentiaProgress>,
    readonly value: A,
  },
  ContentiaError,
  R
> => {
  const recoverableErrors: ContentiaError[] = [];
  const progress: ContentiaProgress[] = [];
  return Effect.map(
    drainWithValue(self, chunk => {
      for (const el of chunk) {
        if (el._tag === recoverableErrorTag) recoverableErrors.push(el.error);
        else progress.push(el.progress);
      }
      return Effect.void;
    }),
    value => ({ recoverableErrors, progress, value }),
  );
};

/**
 * Drain a ContentiaTask ignoring metadata; return only the resolved value.
 *
 * Use in non-delegation contexts (test code, top-level runners) where the
 * caller genuinely doesn't care about recoverable warnings or progress. When
 * the caller is itself a `ContentiaTask.make` body delegating to another task,
 * use {@link runValueForwarding} instead — otherwise the inner task's
 * recoverable warnings die at the delegation boundary.
 */
export const runValue = <A, R>(self: ContentiaTask<A, R>): Effect.Effect<A, ContentiaError, R> =>
  drainWithValue(self, () => Effect.void);

/**
 * Drain a child ContentiaTask, forwarding every recoverableError and progress
 * event to the given outer `emit`, and return the resolved value. Use this
 * when a higher-level repository delegates to a lower-level one and wants
 * the inner repo's warnings to flow through its own outer task — otherwise
 * the lower-level's recoverableErrors die at the boundary because
 * {@link runValue} discards metadata.
 */
export const runValueForwarding = <A, R>(
  self: ContentiaTask<A, R>,
  emit: ContentiaMetadataEmit,
): Effect.Effect<A, ContentiaError, R> =>
  drainWithValue(self, chunk =>
    Effect.gen(function*() {
      for (const el of chunk) {
        if (el._tag === recoverableErrorTag) yield* emit.recoverableError(el.error);
        else yield* emit.progress(el.progress);
      }
    }));

/**
 * Promise-shaped entry point for non-Effect consumers. Drops metadata; the
 * returned Promise resolves with the value or rejects with the fatal
 * `ContentiaError` (no Effect runtime imports required at the call site).
 */
export const runPromise = <A>(self: ContentiaTask<A>): Promise<A> => Effect.runPromise(runValue(self));

/**
 * Promise-shaped entry point that preserves recoverable metadata. Resolves
 * with `{ value, recoverableErrors, progress }`; rejects on fatal `ContentiaError`.
 */
export const runPromiseCollect = <A>(
  self: ContentiaTask<A>,
): Promise<{
  readonly value: A,
  readonly recoverableErrors: ReadonlyArray<ContentiaError>,
  readonly progress: ReadonlyArray<ContentiaProgress>,
}> => Effect.runPromise(runCollect(self));

/**
 * Promise-shaped entry point that captures fatal failures as a `ContentiaResult`
 * instead of rejecting. Useful when the caller wants total recovery without
 * try/catch.
 */
export const runPromiseResult = <A>(
  self: ContentiaTask<A>,
): Promise<Result.Result<A, ContentiaError>> => Effect.runPromise(Effect.result(runValue(self)));

/**
 * Low-level: drain a ContentiaTask invoking `onChunk` per chunk; return the
 * resolved value (Channel's OutDone).
 */
export const drainWithValue = <A, R>(
  self: ContentiaTask<A, R>,
  onChunk: (chunk: ContentiaMetadataChunk) => Effect.Effect<void>,
): Effect.Effect<A, ContentiaError, R> =>
  Effect.scoped(
    Effect.gen(function*() {
      const pull = yield* Channel.toPull(self);
      while (true) {
        const exit = yield* Effect.exit(pull);
        if (Exit.isSuccess(exit)) {
          yield* onChunk(exit.value);
          continue;
        }
        const leftover = Pull.filterDoneLeftover(exit.cause);
        if (Result.isSuccess(leftover)) {
          return leftover.success as A;
        }
        return yield* Effect.failCause(
          leftover.failure as Cause.Cause<ContentiaError>,
        );
      }
    }),
  );

/** Transform the resolved value (Channel's OutDone). */
export const map = <A, B, R>(
  self: ContentiaTask<A, R>,
  f: (a: A) => B,
): ContentiaTask<B, R> => attachAsyncIterator(Channel.mapDone(self, f)) as unknown as ContentiaTask<B, R>;

/** Run a side-effect for every recoverable error. Returns the same task shape. */
export const tapRecoverableErrors = <A, R, R2 = never>(
  self: ContentiaTask<A, R>,
  f: (error: ContentiaError) => Effect.Effect<void, never, R2>,
): ContentiaTask<A, R | R2> =>
  attachAsyncIterator(
    Channel.tap(self, (chunk: ContentiaMetadataChunk) =>
      Effect.gen(function*() {
        for (const el of chunk) if (el._tag === recoverableErrorTag) yield* f(el.error);
      })),
  ) as unknown as ContentiaTask<A, R | R2>;

/** Run a side-effect for every progress event. Returns the same task shape. */
export const tapProgress = <A, R, R2 = never>(
  self: ContentiaTask<A, R>,
  f: (progress: ContentiaProgress) => Effect.Effect<void, never, R2>,
): ContentiaTask<A, R | R2> =>
  attachAsyncIterator(
    Channel.tap(self, (chunk: ContentiaMetadataChunk) =>
      Effect.gen(function*() {
        for (const el of chunk) if (el._tag === progressTag) yield* f(el.progress);
      })),
  ) as unknown as ContentiaTask<A, R | R2>;
