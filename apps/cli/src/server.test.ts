import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import { afterEach, describe, expect, it } from 'vitest';

import { LaikaTask } from 'laikacms/core';
import { InMemoryStorageRepository } from 'laikacms/storage/testing';

import { bearerTokenMatches } from './auth.js';
import { resolveServeBackend } from './commands.js';
import { layerStorageServer } from './server.js';

describe('bearerTokenMatches', () => {
  it('returns true for a correct bearer token', () => {
    expect(bearerTokenMatches('Bearer mysecret', 'mysecret')).toBe(true);
  });

  it('returns false when the token does not match', () => {
    expect(bearerTokenMatches('Bearer wrongtoken', 'mysecret')).toBe(false);
  });

  it('returns false when the header is missing', () => {
    expect(bearerTokenMatches(undefined, 'mysecret')).toBe(false);
  });

  it('returns false for a token that is only a prefix of the expected value', () => {
    expect(bearerTokenMatches('Bearer mysecr', 'mysecret')).toBe(false);
  });

  it('returns false for a token that is a superset of the expected value', () => {
    expect(bearerTokenMatches('Bearer mysecretextra', 'mysecret')).toBe(false);
  });

  it('returns false when the Bearer scheme prefix is absent', () => {
    expect(bearerTokenMatches('mysecret', 'mysecret')).toBe(false);
  });

  it('returns false for an empty header', () => {
    expect(bearerTokenMatches('', 'mysecret')).toBe(false);
  });
});

describe('layerStorageServer', () => {
  const fibers: Fiber.Fiber<unknown, unknown>[] = [];
  afterEach(async () => {
    await Promise.all(fibers.splice(0).map(f => Effect.runPromise(Fiber.interrupt(f))));
  });

  const serve = async (authToken?: string): Promise<string> => {
    const repository = new InMemoryStorageRepository();
    await LaikaTask.runPromise(repository.createObject({ key: 'posts/hello', content: { title: 'Hi' } }));
    return new Promise<string>((resolve, reject) => {
      const fiber = Effect.runFork(Layer.launch(layerStorageServer({
        repository,
        port: 0,
        authToken,
        onListening: url => Effect.sync(() => resolve(url)),
      })));
      fibers.push(fiber);
      fiber.addObserver(exit => reject(exit));
    });
  };

  it('serves the given repository on a free port reported via onListening', async () => {
    const url = await serve();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(url).not.toMatch(/:0$/);
    const body = await fetch(`${url}/objects/posts%2Fhello`).then(r => r.json());
    expect(body.data.attributes.content).toEqual({ title: 'Hi' });
  });

  it('rejects requests without the bearer token when authToken is set', async () => {
    const url = await serve('s3cret');
    expect((await fetch(`${url}/atoms`)).status).toBe(401);
    expect((await fetch(`${url}/atoms`, { headers: { authorization: 'Bearer s3cret' } })).status).toBe(200);
  });
});

describe('resolveServeBackend', () => {
  const none = { _tag: 'None' } as const;
  const some = (value: string) => ({ _tag: 'Some', value }) as const;

  it('defaults to the fs driver rooted at --root', () => {
    expect(resolveServeBackend('laika', { backend: none, backendOptions: none, root: '/c', defaultExtension: 'yaml' }))
      .toEqual({ backend: 'fs', options: { root: '/c', defaultExtension: 'yaml' } });
  });

  it('uses --backend with its parsed --backend-options', () => {
    expect(
      resolveServeBackend('laika', {
        backend: some('s3'),
        backendOptions: some('{"bucket":"b"}'),
        root: '/ignored',
        defaultExtension: 'md',
      }),
    ).toEqual({ backend: 's3', options: { bucket: 'b' } });
  });

  it('rejects --backend-options without --backend instead of silently serving fs', () => {
    expect(() =>
      resolveServeBackend('laika', { backend: none, backendOptions: some('{}'), root: '/c', defaultExtension: 'md' })
    ).toThrow('--backend-options needs --backend');
  });

  it('rejects options that are not a JSON object', () => {
    expect(() =>
      resolveServeBackend('laika', {
        backend: some('s3'),
        backendOptions: some('[1]'),
        root: '/c',
        defaultExtension: 'md',
      })
    ).toThrow('--backend-options must be a JSON object');
  });
});
