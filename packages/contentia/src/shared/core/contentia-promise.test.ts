import * as Channel from 'effect/Channel';
import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';

import { InvalidData } from 'contentia/core';

import * as ContentiaStream from './contentia-stream.js';
import * as ContentiaTask from './contentia-task.js';
import type { ContentiaMetadata } from './contentia-types.js';

// The Promise-friendly members every task and stream carries: `await task`, `task.run()`,
// `for await (const item of stream)` and `stream.collect()`.

describe('await task', () => {
  it('resolves with the task value on success', async () => {
    expect(await ContentiaTask.succeed(42)).toBe(42);
  });

  it('rejects with the ContentiaError on failure', async () => {
    const error = new InvalidData('bad');
    await expect(ContentiaTask.fail(error)).rejects.toBe(error);
  });

  it('silently discards metadata', async () => {
    const task = ContentiaTask.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'start', current: 0 });
        yield* emit.recoverableError(new InvalidData('recoverable'));
        return 99;
      })
    );
    expect(await task).toBe(99);
  });

  it('is lazy: nothing runs until awaited, and every await runs the task again', async () => {
    let runs = 0;
    const task = ContentiaTask.make<number>(() => Effect.sync(() => ++runs));
    expect(runs).toBe(0);
    expect(await task).toBe(1);
    expect(await task).toBe(2);
  });

  it('works with Promise.all', async () => {
    expect(await Promise.all([ContentiaTask.succeed(1), ContentiaTask.succeed('two')])).toEqual([1, 'two']);
  });
});

describe('task.run(options)', () => {
  it('resolves like await without options', async () => {
    await expect(ContentiaTask.succeed(42).run()).resolves.toBe(42);
  });

  it('fires onProgress for each Progress and RecoverableError in order', async () => {
    const recErr = new InvalidData('recoverable');
    const task = ContentiaTask.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'start', current: 0 });
        yield* emit.recoverableError(recErr);
        yield* emit.progress({ stage: 'end', current: 1 });
        return 42;
      })
    );

    const received: ContentiaMetadata[] = [];
    const onProgress = vi.fn((meta: ContentiaMetadata) => received.push(meta));
    const result = await task.run({ onProgress });

    expect(result).toBe(42);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(received[0]).toEqual({ _tag: 'Progress', progress: { stage: 'start', current: 0 } });
    expect(received[1]).toEqual({ _tag: 'RecoverableError', error: recErr });
    expect(received[2]).toEqual({ _tag: 'Progress', progress: { stage: 'end', current: 1 } });
  });

  it('rejects with the ContentiaError on failure', async () => {
    const error = new InvalidData('bad');
    await expect(ContentiaTask.fail(error).run({ onProgress: () => {} })).rejects.toBe(error);
  });
});

describe('for await (const item of stream)', () => {
  const mixed = () =>
    ContentiaStream.make<string, { total: number }>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'loading' });
        yield* emit.data('a');
        yield* emit.recoverableError(new InvalidData('warn'));
        yield* emit.dataMany(['b', 'c']);
        return { total: 3 };
      })
    );

  it('yields the data items in order, skipping progress and warnings', async () => {
    const items: string[] = [];
    for await (const item of mixed()) items.push(item);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  it('returns the done value when iterated by hand', async () => {
    const it = mixed()[Symbol.asyncIterator]();
    const steps: IteratorResult<string, { total: number }>[] = [];
    for (let step = await it.next();; step = await it.next()) {
      steps.push(step);
      if (step.done) break;
    }
    expect(steps.at(-1)).toEqual({ done: true, value: { total: 3 } });
  });

  it('stops and closes the stream on break', async () => {
    let finalized = false;
    const stream = ContentiaStream.make<number, Record<string, never>>(emit =>
      Effect.gen(function*() {
        yield* emit.dataMany([1, 2, 3]);
        yield* emit.dataMany([4, 5, 6]);
        return {};
      }).pipe(Effect.ensuring(Effect.sync(() => (finalized = true))))
    );
    const seen: number[] = [];
    for await (const item of stream) {
      seen.push(item);
      if (item === 2) break;
    }
    expect(seen).toEqual([1, 2]);
    // Leftover buffered items are not yielded after the iterator is closed.
    const it = stream[Symbol.asyncIterator]();
    await it.next();
    await it.return!(undefined as never);
    expect(await it.next()).toMatchObject({ done: true });
    await vi.waitFor(() => expect(finalized).toBe(true));
  });

  it('throws the fatal ContentiaError', async () => {
    const error = new InvalidData('stream failed');
    await expect((async () => {
      for await (const _ of ContentiaStream.fail(error)) {
        /* unreachable */
      }
    })()).rejects.toBe(error);
  });

  it('runs the stream again on every pass', async () => {
    const stream = ContentiaStream.succeedMany([1, 2], {});
    const first: number[] = [];
    const second: number[] = [];
    for await (const item of stream) first.push(item);
    for await (const item of stream) second.push(item);
    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
  });
});

describe('stream.collect(options)', () => {
  it('collects all data values in order', async () => {
    const result = await ContentiaStream.succeedMany([1, 2, 3], {}).collect();
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.done).toEqual({});
  });

  it('silently discards metadata when onProgress is omitted', async () => {
    const stream = ContentiaStream.make<string, { total: number }>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'loading' });
        yield* emit.data('a');
        yield* emit.recoverableError(new InvalidData('warn'));
        yield* emit.data('b');
        return { total: 2 };
      })
    );
    const result = await stream.collect();
    expect(result.items).toEqual(['a', 'b']);
    expect(result.done).toEqual({ total: 2 });
  });

  it('returns empty items for an empty stream', async () => {
    const done = { total: 0 };
    const result = await ContentiaStream.empty(done).collect();
    expect(result.items).toEqual([]);
    expect(result.done).toBe(done);
  });

  it('rejects with the ContentiaError on stream failure', async () => {
    const error = new InvalidData('stream failed');
    await expect(ContentiaStream.fail(error).collect()).rejects.toBe(error);
  });

  it('preserves the typed done value', async () => {
    const done = { pagination: { page: 2, pageSize: 10 }, total: 25 };
    const result = await ContentiaStream.succeed('only', done).collect();
    expect(result.items).toEqual(['only']);
    expect(result.done).toEqual(done);
  });

  it('fires onProgress for metadata events and collects data into items', async () => {
    const progErr = new InvalidData('warn');
    const stream = ContentiaStream.make<string, { total: number }>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'loading' });
        yield* emit.data('hello');
        yield* emit.recoverableError(progErr);
        yield* emit.data('world');
        return { total: 2 };
      })
    );

    const received: ContentiaMetadata[] = [];
    const onProgress = vi.fn((meta: ContentiaMetadata) => received.push(meta));
    const result = await stream.collect({ onProgress });

    expect(result.items).toEqual(['hello', 'world']);
    expect(result.done).toEqual({ total: 2 });
    // onProgress must only be called for metadata, not for data
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(received[0]).toEqual({ _tag: 'Progress', progress: { stage: 'loading' } });
    expect(received[1]).toEqual({ _tag: 'RecoverableError', error: progErr });
  });
});

// The members live on each Channel instance, so a constructor or combinator that forgets to go
// through `fromChannel` returns an object whose type promises `then` / `collect` but which lacks
// them at runtime. For a task that is silent: `await task` resolves to the task object itself. These
// tests pin every builder, and fail when a new export is added without being classified here.

const taskBuilders: Record<string, () => ContentiaTask.ContentiaTask<unknown>> = {
  fromChannel: () => ContentiaTask.fromChannel(Channel.end(1)),
  succeed: () => ContentiaTask.succeed(1),
  fail: () => ContentiaTask.fail(new InvalidData('x')),
  fromEffect: () => ContentiaTask.fromEffect(Effect.succeed({ value: 1 })),
  make: () => ContentiaTask.make(() => Effect.succeed(1)),
  map: () => ContentiaTask.map(ContentiaTask.succeed(1), n => n + 1),
  tapRecoverableErrors: () => ContentiaTask.tapRecoverableErrors(ContentiaTask.succeed(1), () => Effect.void),
  tapProgress: () => ContentiaTask.tapProgress(ContentiaTask.succeed(1), () => Effect.void),
};
const taskConsumers = [
  'runCollect',
  'runValue',
  'runValueForwarding',
  'runPromise',
  'runPromiseCollect',
  'runPromiseResult',
  'drainWithValue',
];

const base = () => ContentiaStream.succeedMany([1, 2], {});
const streamBuilders: Record<string, () => ContentiaStream.ContentiaStream<unknown>> = {
  fromChannel: () => ContentiaStream.fromChannel(Channel.end({})),
  empty: () => ContentiaStream.empty({}),
  succeed: () => ContentiaStream.succeed(1, {}),
  succeedMany: base,
  fail: () => ContentiaStream.fail(new InvalidData('x')),
  fromEffect: () => ContentiaStream.fromEffect(Effect.succeed({ value: 1, done: {} })),
  make: () => ContentiaStream.make(() => Effect.succeed({})),
  paginate: () => ContentiaStream.paginate(undefined, () => Effect.succeed({ items: [1], done: {} })),
  tapRecoverableErrors: () => ContentiaStream.tapRecoverableErrors(base(), () => Effect.void),
  tapProgress: () => ContentiaStream.tapProgress(base(), () => Effect.void),
  mapData: () => ContentiaStream.mapData(base(), n => n + 1),
  mapElements: () => ContentiaStream.mapElements(base(), el => el),
  filter: () => ContentiaStream.filter(base(), n => n > 1),
  mapDone: () => ContentiaStream.mapDone(base(), d => d),
};
const streamConsumers = [
  'drainWithDone',
  'runCollect',
  'runDone',
  'runCollectForwarding',
  'runPromise',
  'runPromiseCollect',
  'runPromiseResult',
];

const exportedFunctions = (module: object) =>
  Object.entries(module).filter(([, value]) => typeof value === 'function').map(([name]) => name).sort();

describe('every task and stream carries its Promise-friendly members', () => {
  it('classifies every ContentiaTask export as a builder or a consumer', () => {
    expect(exportedFunctions(ContentiaTask)).toEqual([...Object.keys(taskBuilders), ...taskConsumers].sort());
  });

  it('classifies every ContentiaStream export as a builder or a consumer', () => {
    expect(exportedFunctions(ContentiaStream)).toEqual([...Object.keys(streamBuilders), ...streamConsumers].sort());
  });

  it.each(Object.entries(taskBuilders))(
    'ContentiaTask.%s returns a task with run, then and an iterator',
    (_, build) => {
      const task = build();
      expect(Object.hasOwn(task, 'run')).toBe(true);
      expect(Object.hasOwn(task, 'then')).toBe(true);
      expect(Object.hasOwn(task, Symbol.asyncIterator)).toBe(true);
    },
  );

  it.each(Object.entries(streamBuilders))(
    'ContentiaStream.%s returns a stream with collect and an iterator',
    (_, build) => {
      const stream = build();
      expect(Object.hasOwn(stream, 'collect')).toBe(true);
      expect(Object.hasOwn(stream, Symbol.asyncIterator)).toBe(true);
    },
  );

  it('keeps the members off enumeration, so spreading or logging a task stays clean', () => {
    const task = ContentiaTask.succeed(1);
    expect(Object.keys(task)).not.toContain('run');
    expect(Object.keys(task)).not.toContain('then');
    expect(Object.keys(ContentiaStream.succeed(1, {}))).not.toContain('collect');
  });

  it('leaves plain Effect channels alone; fromChannel restores the members', async () => {
    const plain = Channel.map(base(), chunk => chunk);
    expect('collect' in plain).toBe(false);
    expect('then' in Channel.end(1)).toBe(false);
    const { items } = await ContentiaStream.fromChannel(plain).collect();
    expect(items).toEqual([1, 2]);
  });
});
