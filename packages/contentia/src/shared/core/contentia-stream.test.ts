import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import { describe, expect, it } from 'vitest';

import { NotFoundError } from 'contentia/core';

import * as Element from './contentia-element.js';
import type { ContentiaElement } from './contentia-element.js';
import {
  type ContentiaChunk,
  type ContentiaStream,
  drainWithDone,
  empty,
  fail,
  filter,
  fromEffect,
  make,
  mapData,
  mapDone,
  mapElements,
  paginate,
  runCollect,
  runCollectForwarding,
  runDone,
  runPromise,
  runPromiseCollect,
  runPromiseResult,
  succeed,
  succeedMany,
  tapProgress,
  tapRecoverableErrors,
} from './contentia-stream.js';
import type { ContentiaDone, ContentiaProgress } from './contentia-types.js';

/**
 * Drain a ContentiaStream by manual async iteration. Returns the collected chunks
 * and the done value that came from the iterator's terminal `return` value.
 */
async function drainIterator<A, D extends ContentiaDone>(
  stream: ContentiaStream<A, D>,
): Promise<{ chunks: ContentiaChunk<A>[], done: D | undefined }> {
  const it = stream[Symbol.asyncIterator]();
  const chunks: ContentiaChunk<A>[] = [];
  let done: D | undefined;
  while (true) {
    const step = await it.next();
    if (step.done) {
      done = step.value;
      break;
    }
    chunks.push(step.value);
  }
  return { chunks, done };
}

/** Flatten all elements across all chunks. */
const flatten = <A>(chunks: ContentiaChunk<A>[]): ContentiaElement<A>[] => chunks.flatMap(c => Array.from(c));

const emptyDone: ContentiaDone = {};

describe('ContentiaElement smart constructors', () => {
  it('data() builds a Data element', () => {
    const el = Element.data(42);
    expect(el).toEqual({ _tag: 'Data', value: 42 });
    expect(Element.isData(el)).toBe(true);
    expect(Element.isRecoverableError(el)).toBe(false);
    expect(Element.isProgress(el)).toBe(false);
  });

  it('warning() builds a Warning element', () => {
    const err = new NotFoundError('missing');
    const el = Element.recoverableError(err);
    expect(el).toEqual({ _tag: 'RecoverableError', error: err });
    expect(Element.isRecoverableError(el)).toBe(true);
  });

  it('progress() builds a Progress element', () => {
    const p: ContentiaProgress = { stage: 'init', current: 0 };
    const el = Element.progress(p);
    expect(el).toEqual({ _tag: 'Progress', progress: p });
    expect(Element.isProgress(el)).toBe(true);
  });
});

describe('ContentiaStream — basic constructors', () => {
  it('empty() yields no chunks; iterator return-value is the done value', async () => {
    const { chunks, done } = await drainIterator(empty({ total: 0 }));
    expect(chunks).toEqual([]);
    expect(done).toEqual({ total: 0 });
  });

  it('succeed() yields one chunk with one data element', async () => {
    const { chunks, done } = await drainIterator(succeed('hi', emptyDone));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual([{ _tag: 'Data', value: 'hi' }]);
    expect(done).toEqual(emptyDone);
  });

  it('succeedMany([], done) emits zero chunks then done value', async () => {
    const { chunks, done } = await drainIterator(succeedMany<number, ContentiaDone>([], emptyDone));
    expect(chunks).toEqual([]);
    expect(done).toEqual(emptyDone);
  });

  it('succeedMany([1,2,3], done) emits one chunk of three data elements', async () => {
    const { chunks, done } = await drainIterator(succeedMany([1, 2, 3], emptyDone));
    expect(chunks).toHaveLength(1);
    expect(flatten(chunks)).toEqual([
      { _tag: 'Data', value: 1 },
      { _tag: 'Data', value: 2 },
      { _tag: 'Data', value: 3 },
    ]);
    expect(done).toEqual(emptyDone);
  });

  it('fail(err) — iterator throws the ContentiaError, no done value', async () => {
    const err = new NotFoundError('boom');
    const it = fail(err)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBe(err);
  });

  it('fromEffect emits warnings then data then done value', async () => {
    const w1 = new NotFoundError('warn-1');
    const stream = fromEffect(
      Effect.succeed({ value: 'final', done: emptyDone, recoverableErrors: [w1] }),
    );
    const { chunks, done } = await drainIterator(stream);
    expect(flatten(chunks)).toEqual([
      { _tag: 'RecoverableError', error: w1 },
      { _tag: 'Data', value: 'final' },
    ]);
    expect(done).toEqual(emptyDone);
  });

  it('fromEffect failure surfaces as fatal', async () => {
    const err = new NotFoundError('fail');
    const stream = fromEffect(Effect.fail(err) as Effect.Effect<never, NotFoundError>);
    const it = (stream as ContentiaStream<never, ContentiaDone>)[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toBe(err);
  });
});

describe('ContentiaStream — make builder', () => {
  it('emits data, warnings, progress in builder order; ends with done value', async () => {
    const w = new NotFoundError('warn');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'start', current: 0 });
        yield* emit.data(1);
        yield* emit.recoverableError(w);
        yield* emit.data(2);
        yield* emit.progress({ stage: 'end', current: 2 });
        return emptyDone;
      })
    );
    const { chunks, done } = await drainIterator(stream);
    expect(done).toEqual(emptyDone);
    const flat = flatten(chunks);
    expect(flat).toHaveLength(5);
    expect(flat[0]).toEqual({ _tag: 'Progress', progress: { stage: 'start', current: 0 } });
    expect(flat[1]).toEqual({ _tag: 'Data', value: 1 });
    expect(flat[2]).toEqual({ _tag: 'RecoverableError', error: w });
    expect(flat[3]).toEqual({ _tag: 'Data', value: 2 });
    expect(flat[4]).toEqual({ _tag: 'Progress', progress: { stage: 'end', current: 2 } });
  });

  it('make builder failure throws the fatal error', async () => {
    const err = new NotFoundError('mid-stream');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        return yield* Effect.fail(err);
      })
    );
    const it = stream[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    await expect(it.next()).rejects.toBe(err);
  });

  it('a builder that dies with a defect rejects instead of hanging', async () => {
    const stream = make<number, ContentiaDone>(() =>
      Effect.sync(() => {
        throw new TypeError('boom — not a ContentiaError');
      })
    );
    await expect(runPromise(stream)).rejects.toThrow('boom — not a ContentiaError');
  });

  it('dataMany emits all items', async () => {
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.dataMany([10, 20, 30]);
        return emptyDone;
      })
    );
    const { chunks, done } = await drainIterator(stream);
    expect(flatten(chunks).map(el => Element.isData(el) && el.value)).toEqual([10, 20, 30]);
    expect(done).toEqual(emptyDone);
  });
});

describe('ContentiaStream — paginate', () => {
  it('walks through pages and returns the last done value', async () => {
    interface Sum extends ContentiaDone {
      readonly pageCount: number;
    }
    const pages: Record<string, { items: number[], nextCursor?: string, done: Sum }> = {
      __initial__: { items: [1, 2], nextCursor: 'c1', done: { pageCount: 1 } },
      c1: { items: [3, 4], nextCursor: 'c2', done: { pageCount: 2 } },
      c2: { items: [5], done: { pageCount: 3 } },
    };
    const stream = paginate<number, Sum>(undefined, cursor => Effect.succeed(pages[cursor ?? '__initial__']!));
    const { chunks, done } = await drainIterator(stream);
    const dataValues = flatten(chunks)
      .filter(Element.isData)
      .map(el => el.value);
    expect(dataValues).toEqual([1, 2, 3, 4, 5]);
    expect(done).toEqual({ pageCount: 3 });
  });

  it('omits the data chunk when a page has no items', async () => {
    const stream = paginate<number, ContentiaDone>(
      undefined,
      () => Effect.succeed({ items: [], done: emptyDone }),
    );
    const { chunks, done } = await drainIterator(stream);
    expect(flatten(chunks).filter(Element.isData)).toEqual([]);
    expect(done).toEqual(emptyDone);
  });
});

describe('ContentiaStream — run helpers', () => {
  it('runCollect bucketises data/warnings/progress and returns done value', async () => {
    const w = new NotFoundError('warn');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.recoverableError(w);
        yield* emit.progress({ stage: 'mid' });
        yield* emit.data(2);
        return emptyDone;
      })
    );
    const result = await Effect.runPromise(runCollect(stream));
    expect(result.data).toEqual([1, 2]);
    expect(result.recoverableErrors).toEqual([w]);
    expect(result.progress).toEqual([{ stage: 'mid' }]);
    expect(result.done).toEqual(emptyDone);
  });

  it('runDone ignores elements, returns done value', async () => {
    const stream = succeedMany([1, 2, 3], { total: 3 });
    const done = await Effect.runPromise(runDone(stream));
    expect(done).toEqual({ total: 3 });
  });

  it('runDone surfaces fatal errors as Effect failure', async () => {
    const err = new NotFoundError('boom');
    const exit = await Effect.runPromiseExit(runDone(fail(err)));
    expect(exit._tag).toBe('Failure');
  });

  it('runCollectForwarding returns data + done, and re-emits child warnings + progress into the outer emit', async () => {
    const childWarning = new NotFoundError('child:missing-row');
    const child = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.recoverableError(childWarning);
        yield* emit.data(2);
        yield* emit.progress({ stage: 'child-done' });
        return { total: 2 };
      })
    );
    const outer = make<string, ContentiaDone>(outerEmit =>
      Effect.gen(function*() {
        const { data, done } = yield* runCollectForwarding(child, outerEmit);
        for (const n of data) yield* outerEmit.data(`v${n}`);
        return done;
      })
    );
    const collected = await Effect.runPromise(runCollect(outer));
    expect(collected.data).toEqual(['v1', 'v2']);
    expect(collected.done).toEqual({ total: 2 });
    expect(collected.recoverableErrors).toEqual([childWarning]);
    expect(collected.progress).toEqual([{ stage: 'child-done' }]);
  });

  it('drainWithDone invokes onChunk for each chunk', async () => {
    const seen: ContentiaChunk<number>[] = [];
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.data(2);
        return emptyDone;
      })
    );
    const done = await Effect.runPromise(
      drainWithDone(stream, chunk => {
        seen.push(chunk);
        return Effect.void;
      }),
    );
    expect(done).toEqual(emptyDone);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('tapWarnings invokes callback for each warning and preserves the stream', async () => {
    const observed: string[] = [];
    const w1 = new NotFoundError('w1');
    const w2 = new NotFoundError('w2');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.recoverableError(w1);
        yield* emit.data(1);
        yield* emit.recoverableError(w2);
        return emptyDone;
      })
    );
    const tapped = tapRecoverableErrors(stream, err => {
      observed.push(err.message);
      return Effect.void;
    });
    const result = await Effect.runPromise(runCollect(tapped));
    expect(observed).toEqual(['w1', 'w2']);
    expect(result.data).toEqual([1]);
    expect(result.recoverableErrors).toEqual([w1, w2]);
  });

  it('tapProgress invokes callback for each progress event', async () => {
    const observed: ContentiaProgress[] = [];
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'a' });
        yield* emit.progress({ stage: 'b' });
        return emptyDone;
      })
    );
    const tapped = tapProgress(stream, p => {
      observed.push(p);
      return Effect.void;
    });
    await Effect.runPromise(runDone(tapped));
    expect(observed).toEqual([{ stage: 'a' }, { stage: 'b' }]);
  });
});

describe('ContentiaStream — combinators', () => {
  it('mapData transforms data; warnings/progress pass through', async () => {
    const w = new NotFoundError('w');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.recoverableError(w);
        yield* emit.data(2);
        return emptyDone;
      })
    );
    const mapped = mapData(stream, n => `n${n}`);
    const collected = await Effect.runPromise(runCollect(mapped));
    expect(collected.data).toEqual(['n1', 'n2']);
    expect(collected.recoverableErrors).toEqual([w]);
  });

  it('mapElements transforms every element', async () => {
    const stream = succeedMany([1, 2], emptyDone);
    const mapped = mapElements(stream, el => Element.isData(el) ? Element.data(el.value + 100) : el);
    const collected = await Effect.runPromise(runCollect(mapped));
    expect(collected.data).toEqual([101, 102]);
  });

  it('filter keeps matching data; warnings/progress always pass', async () => {
    const w = new NotFoundError('w');
    const stream = make<number, ContentiaDone>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.data(2);
        yield* emit.recoverableError(w);
        yield* emit.data(3);
        return emptyDone;
      })
    );
    const filtered = filter(stream, n => n % 2 === 1);
    const collected = await Effect.runPromise(runCollect(filtered));
    expect(collected.data).toEqual([1, 3]);
    expect(collected.recoverableErrors).toEqual([w]);
  });

  it('mapDone transforms the typed done value', async () => {
    interface ExtDone extends ContentiaDone {
      readonly note: string;
    }
    const stream = succeedMany([1], emptyDone);
    const remapped = mapDone(stream, (_d): ExtDone => ({ note: 'extended' }));
    const collected = await Effect.runPromise(runCollect(remapped));
    expect(collected.done).toEqual({ note: 'extended' });
    expect(collected.data).toEqual([1]);
  });
});

describe('ContentiaStream — iterator semantics', () => {
  it('a second [Symbol.asyncIterator]() call produces an independent iterator', async () => {
    const stream = succeedMany([1, 2], emptyDone);
    const first = await drainIterator(stream);
    const second = await drainIterator(stream);
    expect(first.done).toEqual(emptyDone);
    expect(second.done).toEqual(emptyDone);
    expect(flatten(first.chunks).filter(Element.isData).length).toBe(2);
    expect(flatten(second.chunks).filter(Element.isData).length).toBe(2);
  });

  it('iterator.return() closes the iterator with the provided done value', async () => {
    const stream = succeedMany([1, 2, 3, 4, 5], emptyDone);
    const it = stream[Symbol.asyncIterator]();
    await it.next();
    const returned = await it.return!(undefined as never);
    expect(returned.done).toBe(true);
  });

  it('iterator.throw() rethrows the injected error to the caller', async () => {
    const stream = succeedMany([1, 2, 3], emptyDone);
    const it = stream[Symbol.asyncIterator]();
    await it.next();
    const injected = new Error('injected from consumer');
    await expect(it.throw!(injected)).rejects.toBe(injected);
  });

  it('iterator.throw() closes the scope — subsequent next() calls return done immediately', async () => {
    const stream = succeedMany([1, 2, 3], emptyDone);
    const it = stream[Symbol.asyncIterator]();
    await it.next();
    try {
      await it.throw!(new Error('boom'));
    } catch {
      // expected — throw() always rethrows
    }
    const after = await it.next();
    expect(after.done).toBe(true);
  });

  it('iterator.throw() before first next() still rethrows and leaves iterator closed', async () => {
    const stream = succeedMany([1, 2], emptyDone);
    const it = stream[Symbol.asyncIterator]();
    const err = new NotFoundError('early throw');
    await expect(it.throw!(err)).rejects.toBe(err);
    const after = await it.next();
    expect(after.done).toBe(true);
  });

  it('Symbol.asyncIterator property is non-enumerable on the stream', () => {
    const stream = succeed('x', emptyDone);
    const desc = Object.getOwnPropertyDescriptor(stream, Symbol.asyncIterator);
    expect(desc).toBeDefined();
    expect(desc?.enumerable).toBe(false);
  });
});

describe('ContentiaStream — Promise helpers (non-Effect consumers)', () => {
  const done = { total: 1 } as const;

  it('runPromise resolves with the done value', async () => {
    await expect(runPromise(succeed('hello', done))).resolves.toEqual(done);
  });

  it('runPromise rejects with the fatal ContentiaError', async () => {
    const err = new NotFoundError('nope');
    await expect(runPromise(fail(err))).rejects.toBe(err);
  });

  it('runPromiseCollect resolves with data + bucketed metadata + done', async () => {
    const w = new NotFoundError('warn');
    const stream = make<number, { total: number }>(emit =>
      Effect.gen(function*() {
        yield* emit.data(1);
        yield* emit.recoverableError(w);
        yield* emit.progress({ stage: 'mid' });
        yield* emit.data(2);
        return { total: 2 };
      })
    );
    const out = await runPromiseCollect(stream);
    expect(out.data).toEqual([1, 2]);
    expect(out.recoverableErrors).toEqual([w]);
    expect(out.progress).toEqual([{ stage: 'mid' }]);
    expect(out.done).toEqual({ total: 2 });
  });

  it('runPromiseResult captures fatal failure as a ContentiaResult', async () => {
    const err = new NotFoundError('caught');
    const r = await runPromiseResult(fail(err));
    expect(Result.isFailure(r)).toBe(true);
    if (Result.isFailure(r)) expect(r.failure).toBe(err);
  });

  it('runPromiseResult captures success as a ContentiaResult', async () => {
    const r = await runPromiseResult(succeed('x', done));
    expect(Result.isSuccess(r)).toBe(true);
    if (Result.isSuccess(r)) {
      expect(r.success.data).toEqual(['x']);
      expect(r.success.done).toEqual(done);
    }
  });
});
