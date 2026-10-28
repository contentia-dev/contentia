import * as Effect from 'effect/Effect';
import { describe, expect, it, vi } from 'vitest';
import { collectStream, runTask } from './compat.js';
import * as ContentiaStream from './contentia-stream.js';
import * as ContentiaTask from './contentia-task.js';
import type { ContentiaMetadata } from './contentia-types.js';
import { InvalidData } from './domain/index.js';

describe('runTask', () => {
  it('resolves with the task value on success', async () => {
    await expect(runTask(ContentiaTask.succeed(42))).resolves.toBe(42);
  });

  it('rejects with the ContentiaError on failure', async () => {
    const error = new InvalidData('bad');
    await expect(runTask(ContentiaTask.fail(error))).rejects.toBe(error);
  });

  it('silently discards metadata when onProgress is omitted', async () => {
    const recErr = new InvalidData('recoverable');
    const task = ContentiaTask.make<number>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'start', current: 0 });
        yield* emit.recoverableError(recErr);
        return 99;
      })
    );
    await expect(runTask(task)).resolves.toBe(99);
  });
});

describe('runTask with onProgress', () => {
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
    const result = await runTask(task, { onProgress });

    expect(result).toBe(42);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(received[0]).toEqual({ _tag: 'Progress', progress: { stage: 'start', current: 0 } });
    expect(received[1]).toEqual({ _tag: 'RecoverableError', error: recErr });
    expect(received[2]).toEqual({ _tag: 'Progress', progress: { stage: 'end', current: 1 } });
  });
});

describe('collectStream', () => {
  it('collects all data values in order', async () => {
    const stream = ContentiaStream.succeedMany([1, 2, 3], {});
    const result = await collectStream(stream);
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.done).toEqual({});
  });

  it('silently discards metadata when onProgress is omitted', async () => {
    const recErr = new InvalidData('warn');
    const stream = ContentiaStream.make<string, { total: number }>(emit =>
      Effect.gen(function*() {
        yield* emit.progress({ stage: 'loading' });
        yield* emit.data('a');
        yield* emit.recoverableError(recErr);
        yield* emit.data('b');
        return { total: 2 };
      })
    );
    const result = await collectStream(stream);
    expect(result.items).toEqual(['a', 'b']);
    expect(result.done).toEqual({ total: 2 });
  });

  it('returns empty items for an empty stream', async () => {
    const done = { total: 0 };
    const stream = ContentiaStream.empty(done);
    const result = await collectStream(stream);
    expect(result.items).toEqual([]);
    expect(result.done).toBe(done);
  });

  it('rejects with the ContentiaError on stream failure', async () => {
    const error = new InvalidData('stream failed');
    await expect(collectStream(ContentiaStream.fail(error))).rejects.toBe(error);
  });

  it('preserves the typed done value', async () => {
    const done = { pagination: { page: 2, pageSize: 10 }, total: 25 };
    const stream = ContentiaStream.succeed('only', done);
    const result = await collectStream(stream);
    expect(result.items).toEqual(['only']);
    expect(result.done).toEqual(done);
  });
});

describe('collectStream with onProgress', () => {
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
    const result = await collectStream(stream, { onProgress });

    expect(result.items).toEqual(['hello', 'world']);
    expect(result.done).toEqual({ total: 2 });
    // onProgress must only be called for metadata, not for data
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(received[0]).toEqual({ _tag: 'Progress', progress: { stage: 'loading' } });
    expect(received[1]).toEqual({ _tag: 'RecoverableError', error: progErr });
  });
});
