import type * as Arr from 'effect/Array';
import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Queue from 'effect/Queue';
import * as Result from 'effect/Result';
import type * as Scope from 'effect/Scope';

import type { ContentiaError } from 'contentia/core';

import * as Element from './contentia-element.js';
import type { ContentiaElement } from './contentia-element.js';
import { attachAsyncIterator } from './contentia-iterator.js';
import type { ContentiaMetadataEmit } from './contentia-task.js';
import type { ContentiaDone, ContentiaProgress } from './contentia-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Non-empty chunks of elements emitted by a {@link ContentiaStream}. */
export type ContentiaChunk<A> = Arr.NonEmptyReadonlyArray<ContentiaElement<A>>;

/**
 * `ContentiaStream<A, D, R>` — three logical channels in one construct:
 *
 *   • data       — many `A` values
 *   • metadata   — many progress events + recoverable errors, interleaved
 *   • done       — exactly ONE typed value at the end (Channel's OutDone), the
 *                  stream's closing return value
 *
 * Fatal errors are `ContentiaError` raised through the Channel's OutErr; they
 * terminate the stream without emitting a done value.
 */
export interface ContentiaStream<A, D extends ContentiaDone = ContentiaDone, R = never>
  extends
    Channel.Channel<ContentiaChunk<A>, ContentiaError, D, unknown, unknown, unknown, R>,
    AsyncIterable<ContentiaChunk<A>, D>
{}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Emits no data, ends immediately with the done value. */
export const empty = <D extends ContentiaDone>(done: D): ContentiaStream<never, D> =>
  attachAsyncIterator(Channel.end(done) as never);

/** Emits one data element then ends with the done value. */
export const succeed = <A, D extends ContentiaDone>(value: A, done: D): ContentiaStream<A, D> =>
  attachAsyncIterator(
    Channel.concat(
      Channel.succeed([Element.data(value)] as ContentiaChunk<A>),
      Channel.end(done),
    ) as never,
  );

/**
 * Emits the given data elements (in one chunk) then ends with the done value.
 * An empty `values` array produces no chunks, just the done value.
 */
export const succeedMany = <A, D extends ContentiaDone>(
  values: ReadonlyArray<A>,
  done: D,
): ContentiaStream<A, D> => {
  if (values.length === 0) return empty(done);
  return attachAsyncIterator(
    Channel.concat(
      Channel.succeed(values.map(Element.data) as unknown as ContentiaChunk<A>),
      Channel.end(done),
    ) as never,
  );
};

/** Fails immediately with a fatal ContentiaError, never emitting a done value. */
export const fail = (error: ContentiaError): ContentiaStream<never, never> =>
  attachAsyncIterator(Channel.fail(error) as never);

/**
 * Lift an Effect producing a single value, optional warnings, and a done value
 * into a ContentiaStream.
 */
export const fromEffect = <A, D extends ContentiaDone, R = never>(
  eff: Effect.Effect<
    {
      readonly value: A,
      readonly done: D,
      readonly recoverableErrors?: ReadonlyArray<ContentiaError>,
    },
    ContentiaError,
    R
  >,
): ContentiaStream<A, D, R> =>
  make<A, D, R>(emit =>
    Effect.gen(function*() {
      const { value, done, recoverableErrors } = yield* eff;
      if (recoverableErrors) {
        for (const e of recoverableErrors) yield* emit.recoverableError(e);
      }
      yield* emit.data(value);
      return done;
    })
  );

/**
 * Emit-API exposed to a `make` builder. Each method offers one element into
 * the underlying queue and returns a void Effect.
 */
export interface ContentiaStreamEmit<A> extends ContentiaMetadataEmit {
  readonly data: (value: A) => Effect.Effect<void>;
  readonly dataMany: (values: ReadonlyArray<A>) => Effect.Effect<void>;
}

/**
 * Generator-style builder for arbitrary ContentiaStreams. The builder receives an
 * `emit` API and returns an Effect that resolves to the typed done value.
 *
 * The builder's Effect runs concurrently with the consumer: emissions land in
 * a bounded queue, the consumer pulls chunks as they're ready, and when the
 * builder completes the queue terminates with the done value as its Done leftover.
 */
export const make = <A, D extends ContentiaDone, R = never>(
  build: (emit: ContentiaStreamEmit<A>) => Effect.Effect<D, ContentiaError, R>,
  options?: { readonly capacity?: number },
): ContentiaStream<A, D, R> => {
  const capacity = options?.capacity ?? 16;
  return attachAsyncIterator(
    Channel.fromTransform<
      ContentiaChunk<A>,
      ContentiaError | Cause.Done<D>,
      D,
      unknown,
      unknown,
      unknown,
      never,
      R,
      R
    >((_upstream: unknown, scope: Scope.Scope) =>
      Effect.gen(function*() {
        const queue: Queue.Queue<ContentiaElement<A>, ContentiaError | Cause.Done<D>> = yield* Queue.bounded<
          ContentiaElement<A>,
          ContentiaError | Cause.Done<D>
        >(capacity);

        const emit: ContentiaStreamEmit<A> = {
          data: value => Effect.asVoid(Queue.offer(queue, Element.data(value))),
          recoverableError: error => Effect.asVoid(Queue.offer(queue, Element.recoverableError(error))),
          progress: progress => Effect.asVoid(Queue.offer(queue, Element.progress(progress))),
          dataMany: values => Effect.asVoid(Queue.offerAll(queue, values.map(Element.data))),
        };

        // matchCauseEffect (not matchEffect): a builder that dies with a
        // defect must still terminate the queue — otherwise the forked fiber
        // ends silently and every consumer of the stream hangs forever.
        const builder = build(emit).pipe(
          Effect.matchCauseEffect({
            onSuccess: done => Queue.fail(queue, Cause.Done(done)),
            onFailure: cause => Queue.failCause(queue, cause as Cause.Cause<ContentiaError | Cause.Done<D>>),
          }),
        );
        yield* Effect.forkIn(builder, scope);

        return Queue.takeAll(queue) as never;
      })
    ) as never,
  );
};

/**
 * Paginate through pages, flattening items into the ContentiaStream's data channel.
 * The final done value is taken from the last page fetched ("last wins").
 */
export const paginate = <A, D extends ContentiaDone, R = never>(
  initialCursor: string | undefined,
  fetchPage: (
    cursor: string | undefined,
  ) => Effect.Effect<
    {
      readonly items: ReadonlyArray<A>,
      readonly done: D,
      readonly nextCursor?: string,
    },
    ContentiaError,
    R
  >,
): ContentiaStream<A, D, R> =>
  make<A, D, R>(emit =>
    Effect.gen(function*() {
      let cursor = initialCursor;
      let pageNumber = 0;
      let finalDone: D | undefined;
      while (true) {
        yield* emit.progress({
          stage: 'paginate',
          current: pageNumber,
          message: cursor === undefined ? 'first page' : `cursor: ${cursor}`,
        });
        const page = yield* fetchPage(cursor);
        if (page.items.length > 0) yield* emit.dataMany(page.items);
        finalDone = page.done;
        pageNumber += 1;
        if (page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      return finalDone as D;
    })
  );

// ---------------------------------------------------------------------------
// Run helpers
// ---------------------------------------------------------------------------

/**
 * Drain a ContentiaStream, invoking `onChunk` for every chunk, and return the
 * typed done value the stream terminates with.
 */
export const drainWithDone = <A, D extends ContentiaDone, R>(
  self: ContentiaStream<A, D, R>,
  onChunk: (chunk: ContentiaChunk<A>) => Effect.Effect<void>,
): Effect.Effect<D, ContentiaError, R> =>
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
          return leftover.success as D;
        }
        return yield* Effect.failCause(
          leftover.failure as Cause.Cause<ContentiaError>,
        );
      }
    }),
  );

/**
 * Collect a ContentiaStream into its three buckets plus the done value.
 *
 * When the caller is itself the body of a `ContentiaStream.make` or
 * `ContentiaTask.make` (i.e. it's forwarding through a delegation chain), prefer
 * {@link runCollectForwarding} — it pipes the inner stream's warnings into
 * the outer `emit` instead of leaving the caller to manually re-emit them.
 */
export const runCollect = <A, D extends ContentiaDone, R>(
  self: ContentiaStream<A, D, R>,
): Effect.Effect<
  {
    readonly data: ReadonlyArray<A>,
    readonly recoverableErrors: ReadonlyArray<ContentiaError>,
    readonly progress: ReadonlyArray<ContentiaProgress>,
    readonly done: D,
  },
  ContentiaError,
  R
> => {
  const data: A[] = [];
  const recoverableErrors: ContentiaError[] = [];
  const progress: ContentiaProgress[] = [];
  return Effect.map(
    drainWithDone(self, chunk => {
      for (const el of chunk) {
        if (Element.isData(el)) data.push(el.value);
        else if (Element.isRecoverableError(el)) recoverableErrors.push(el.error);
        else progress.push(el.progress);
      }
      return Effect.void;
    }),
    done => ({ data, recoverableErrors, progress, done }),
  );
};

/**
 * Drain a ContentiaStream, ignoring all elements; return only the done value.
 *
 * Use in non-delegation contexts where the caller genuinely doesn't care
 * about data, recoverable warnings, or progress. When the caller is itself
 * forwarding through a `make` body, use {@link runCollectForwarding} so the
 * inner stream's warnings flow to the outer `emit`.
 */
export const runDone = <A, D extends ContentiaDone, R>(
  self: ContentiaStream<A, D, R>,
): Effect.Effect<D, ContentiaError, R> => drainWithDone(self, () => Effect.void);

/**
 * Drain a child ContentiaStream, forwarding every recoverableError and progress
 * event to the given outer `emit` (data and the done value are returned to
 * the caller). Use this when a higher-level repository's stream delegates to
 * a lower-level stream and wants the inner repo's warnings to flow through
 * its own outer stream — otherwise the lower-level's recoverableErrors die
 * at the boundary because {@link runCollect} returns them but the caller
 * almost always discards them.
 */
export const runCollectForwarding = <A, D extends ContentiaDone, R>(
  self: ContentiaStream<A, D, R>,
  emit: ContentiaMetadataEmit,
): Effect.Effect<{ data: ReadonlyArray<A>, done: D }, ContentiaError, R> => {
  const data: A[] = [];
  return Effect.map(
    drainWithDone(self, chunk =>
      Effect.gen(function*() {
        for (const el of chunk) {
          if (Element.isData(el)) data.push(el.value);
          else if (Element.isRecoverableError(el)) yield* emit.recoverableError(el.error);
          else yield* emit.progress(el.progress);
        }
      })),
    done => ({ data, done }),
  );
};

/**
 * Promise-shaped entry point for non-Effect consumers. Drops data and
 * metadata; resolves with the stream's done value or rejects with the fatal
 * `ContentiaError`.
 */
export const runPromise = <A, D extends ContentiaDone>(self: ContentiaStream<A, D>): Promise<D> =>
  Effect.runPromise(runDone(self));

/**
 * Promise-shaped entry point that collects every channel into one bundle.
 * Resolves with `{ data, recoverableErrors, progress, done }`; rejects on
 * fatal `ContentiaError`.
 */
export const runPromiseCollect = <A, D extends ContentiaDone>(
  self: ContentiaStream<A, D>,
): Promise<{
  readonly data: ReadonlyArray<A>,
  readonly recoverableErrors: ReadonlyArray<ContentiaError>,
  readonly progress: ReadonlyArray<ContentiaProgress>,
  readonly done: D,
}> => Effect.runPromise(runCollect(self));

/**
 * Promise-shaped entry point that captures fatal failures as a `ContentiaResult`
 * instead of rejecting.
 */
export const runPromiseResult = <A, D extends ContentiaDone>(
  self: ContentiaStream<A, D>,
): Promise<
  Result.Result<
    {
      readonly data: ReadonlyArray<A>,
      readonly recoverableErrors: ReadonlyArray<ContentiaError>,
      readonly progress: ReadonlyArray<ContentiaProgress>,
      readonly done: D,
    },
    ContentiaError
  >
> => Effect.runPromise(Effect.result(runCollect(self)));

/** Run a side-effect for every recoverable error. Returns the same stream shape. */
export const tapRecoverableErrors = <A, D extends ContentiaDone, R, R2 = never>(
  self: ContentiaStream<A, D, R>,
  f: (error: ContentiaError) => Effect.Effect<void, never, R2>,
): ContentiaStream<A, D, R | R2> =>
  Channel.tap(self, (chunk: ContentiaChunk<A>) =>
    Effect.gen(function*() {
      for (const el of chunk) if (Element.isRecoverableError(el)) yield* f(el.error);
    })) as ContentiaStream<A, D, R | R2>;

/** Run a side-effect for every progress event. Returns the same stream shape. */
export const tapProgress = <A, D extends ContentiaDone, R, R2 = never>(
  self: ContentiaStream<A, D, R>,
  f: (progress: ContentiaProgress) => Effect.Effect<void, never, R2>,
): ContentiaStream<A, D, R | R2> =>
  Channel.tap(self, (chunk: ContentiaChunk<A>) =>
    Effect.gen(function*() {
      for (const el of chunk) if (Element.isProgress(el)) yield* f(el.progress);
    })) as ContentiaStream<A, D, R | R2>;

// ---------------------------------------------------------------------------
// Combinators
// ---------------------------------------------------------------------------

/**
 * Transform every data value. Warnings, progress, and done value pass through
 * unchanged.
 */
export const mapData = <A, D extends ContentiaDone, R, B>(
  self: ContentiaStream<A, D, R>,
  f: (a: A) => B,
): ContentiaStream<B, D, R> =>
  attachAsyncIterator(
    Channel.map(self, (chunk: ContentiaChunk<A>): ContentiaChunk<B> => {
      const out: ContentiaElement<B>[] = new Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const el = chunk[i]!;
        out[i] = Element.isData(el) ? Element.data(f(el.value)) : (el as ContentiaElement<B>);
      }
      return out as unknown as ContentiaChunk<B>;
    }) as never,
  );

/**
 * Transform every element regardless of tag. The mapping must preserve a
 * non-empty mapping per chunk, otherwise use {@link filter}.
 */
export const mapElements = <A, D extends ContentiaDone, R, B>(
  self: ContentiaStream<A, D, R>,
  f: (element: ContentiaElement<A>) => ContentiaElement<B>,
): ContentiaStream<B, D, R> =>
  attachAsyncIterator(
    Channel.map(self, (chunk: ContentiaChunk<A>): ContentiaChunk<B> => {
      const out: ContentiaElement<B>[] = new Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) out[i] = f(chunk[i]!);
      return out as unknown as ContentiaChunk<B>;
    }) as never,
  );

/**
 * Filter on data only. Warnings and progress always pass through. Chunks that
 * would become empty after filtering are dropped entirely.
 */
export const filter = <A, D extends ContentiaDone, R>(
  self: ContentiaStream<A, D, R>,
  predicate: (a: A) => boolean,
): ContentiaStream<A, D, R> =>
  attachAsyncIterator(
    Channel.filterArray(self, (el): el is ContentiaElement<A> => {
      if (Element.isData(el)) return predicate(el.value);
      return true;
    }) as never,
  );

/** Transform the typed done value. */
export const mapDone = <A, D1 extends ContentiaDone, D2 extends ContentiaDone, R>(
  self: ContentiaStream<A, D1, R>,
  f: (done: D1) => D2,
): ContentiaStream<A, D2, R> => attachAsyncIterator(Channel.mapDone(self, f) as never);
