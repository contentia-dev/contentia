import type * as Arr from 'effect/Array';
import * as Cause from 'effect/Cause';
import * as Channel from 'effect/Channel';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Pull from 'effect/Pull';
import * as Result from 'effect/Result';
import * as Scope from 'effect/Scope';

import { ContentiaError, UnknownError } from 'contentia/core';

import { type ContentiaElement, isData } from './contentia-element.js';

/** An async iterator that is also its own iterable, like the ones generators return. */
export type ContentiaIterator<T, Done> = AsyncIterator<T, Done> & AsyncIterable<T, Done>;

type AnyChannel<Elem, Done> = Channel.Channel<
  Arr.NonEmptyReadonlyArray<Elem>,
  ContentiaError,
  Done,
  unknown,
  unknown,
  unknown,
  unknown
>;

/**
 * Pull a Channel's output chunk by chunk, outside Effect.
 *
 * The iterator yields non-empty chunks of `Elem`; its terminal `return` value carries the
 * Channel's typed OutDone. A ContentiaTask exposes this directly as its async iterator (chunks of
 * metadata); a ContentiaStream builds its item iterator on top of it ({@link iterateItems}).
 *
 * Fatal ContentiaError surfaces as a thrown error from `next()`. Non-ContentiaError defects are
 * wrapped in UnknownError so the contract "thrown things are ContentiaError" always holds.
 *
 * Runs with an empty service context: a channel with unfilled requirements (R != never) throws at
 * the first `next()`. Repositories provide their services at construction time, so the tasks and
 * streams their methods return are R = never in practice.
 */
export const iterateChunks = <Elem, Done>(
  channel: AnyChannel<Elem, Done>,
): ContentiaIterator<Arr.NonEmptyReadonlyArray<Elem>, Done> => {
  const services = Context.empty() as Context.Context<unknown>;
  let scope: Scope.Closeable | undefined;
  let pull:
    | Effect.Effect<Arr.NonEmptyReadonlyArray<Elem>, ContentiaError | Cause.Done<Done>, unknown>
    | undefined;
  let closed = false;

  const ensureScope = async (): Promise<Scope.Closeable> => {
    if (scope) return scope;
    scope = await Effect.runPromise(
      Effect.provideContext(Scope.make(), services),
    );
    return scope;
  };

  const ensurePull = async (): Promise<
    Effect.Effect<Arr.NonEmptyReadonlyArray<Elem>, ContentiaError | Cause.Done<Done>, unknown>
  > => {
    if (pull) return pull;
    const s = await ensureScope();
    pull = await Effect.runPromise(
      Effect.provideContext(Channel.toPullScoped(channel, s), services),
    );
    return pull;
  };

  const closeScope = async (exit: Exit.Exit<unknown, unknown>): Promise<void> => {
    if (!scope) return;
    const s = scope;
    scope = undefined;
    try {
      await Effect.runPromise(Effect.provideContext(Scope.close(s, exit), services));
    } catch {
      // finalisers should not throw; if they do, swallow — we're already cleaning up.
    }
  };

  const iterator: ContentiaIterator<Arr.NonEmptyReadonlyArray<Elem>, Done> = {
    async next(): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
      if (closed) return { value: undefined as never, done: true };
      let exit: Exit.Exit<Arr.NonEmptyReadonlyArray<Elem>, ContentiaError | Cause.Done<Done>>;
      try {
        const p = await ensurePull();
        exit = await Effect.runPromiseExit(Effect.provideContext(p, services));
      } catch (err) {
        closed = true;
        await closeScope(Exit.succeed(undefined));
        if (err instanceof ContentiaError) throw err;
        throw new UnknownError(messageOf(err), { cause: err });
      }
      if (Exit.isSuccess(exit)) {
        return { value: exit.value, done: false };
      }
      const leftover = Pull.filterDoneLeftover(exit.cause);
      if (Result.isSuccess(leftover)) {
        closed = true;
        await closeScope(Exit.succeed(undefined));
        return { value: leftover.success as Done, done: true };
      }
      closed = true;
      await closeScope(exit);
      const fatal = firstFailError(leftover.failure);
      if (fatal instanceof ContentiaError) throw fatal;
      throw new UnknownError(messageOf(fatal), { cause: fatal });
    },

    async return(value?: Done): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
      if (!closed) {
        closed = true;
        await closeScope(Exit.succeed(undefined));
      }
      return { value: value as Done, done: true };
    },

    async throw(err?: unknown): Promise<IteratorResult<Arr.NonEmptyReadonlyArray<Elem>, Done>> {
      if (!closed) {
        closed = true;
        await closeScope(Exit.failCause(Cause.die(err)));
      }
      throw err;
    },

    [Symbol.asyncIterator]: () => iterator,
  };
  return iterator;
};

/**
 * Pull a stream's data items one at a time, skipping progress events and recoverable warnings.
 * The terminal `return` value is the stream's done value; breaking out early closes the stream.
 */
export const iterateItems = <A, Done>(
  channel: AnyChannel<ContentiaElement<A>, Done>,
): ContentiaIterator<A, Done> => {
  const chunks = iterateChunks(channel);
  let buffer: A[] = [];
  let index = 0;

  const iterator: ContentiaIterator<A, Done> = {
    async next(): Promise<IteratorResult<A, Done>> {
      while (index >= buffer.length) {
        const step = await chunks.next();
        if (step.done) return step;
        buffer = [];
        index = 0;
        for (const el of step.value) if (isData(el)) buffer.push(el.value);
      }
      return { value: buffer[index++] as A, done: false };
    },

    async return(value?: Done): Promise<IteratorResult<A, Done>> {
      buffer = [];
      await chunks.return!(value);
      return { value: value as Done, done: true };
    },

    async throw(err?: unknown): Promise<IteratorResult<A, Done>> {
      buffer = [];
      await chunks.throw!(err);
      throw err;
    },

    [Symbol.asyncIterator]: () => iterator,
  };
  return iterator;
};

/**
 * Define a non-enumerable, read-only member on a Channel instance. Contentia adds its
 * Promise-friendly members per instance, never to Effect's shared Channel prototype, so plain Effect
 * channels stay unchanged.
 */
export const defineMember = (target: object, key: PropertyKey, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: false, configurable: false, writable: false });
};

const messageOf = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'ContentiaStream iteration failed';
};

const firstFailError = (cause: Cause.Cause<unknown>): unknown => {
  for (const reason of cause.reasons) {
    if (reason._tag === 'Fail') return (reason as { error: unknown }).error;
  }
  for (const reason of cause.reasons) {
    if (reason._tag === 'Die') return (reason as { defect: unknown }).defect;
  }
  return cause;
};
