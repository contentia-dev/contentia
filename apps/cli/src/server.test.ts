import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as IpNetwork from 'effect/net/IpNetwork';
import { afterEach, describe, expect, it } from 'vitest';

import { ContentiaTask } from 'contentia/core';
import { InMemoryStorageRepository } from 'contentia/storage/testing';

import { bearerTokenMatches } from './auth.js';
import { resolveServeBackend } from './commands.js';
import { layerFetchServer, layerStorageServer } from './server.js';
import { parseTrustedProxy } from './trusted-proxies.js';

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
    await ContentiaTask.runPromise(repository.createObject({ key: 'posts/hello', content: { title: 'Hi' } }));
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

describe('layerFetchServer behind a reverse proxy', () => {
  const fibers: Fiber.Fiber<unknown, unknown>[] = [];
  afterEach(async () => {
    await Promise.all(fibers.splice(0).map(f => Effect.runPromise(Fiber.interrupt(f))));
  });

  /** Serve a handler that answers with the URL it was given. */
  const serveEcho = (trustedProxies?: string[]): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const fiber = Effect.runFork(Layer.launch(layerFetchServer({
        fetch: request => Promise.resolve(new Response(request.url)),
        port: 0,
        ...(trustedProxies && { trustedProxies }),
        onListening: url => Effect.sync(() => resolve(url)),
      })));
      fibers.push(fiber);
      fiber.addObserver(exit => reject(exit));
    });

  // What a TLS-terminating proxy in front of the server adds for one client.
  const forwarded = {
    'x-forwarded-for': '203.0.113.7',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'cms.example.com',
  };

  it('gives the handler the scheme and host the client used when the proxy is trusted', async () => {
    const url = await serveEcho(['127.0.0.1']);
    const seen = await fetch(`${url}/api/health?x=1`, { headers: forwarded }).then(r => r.text());
    expect(seen).toBe('https://cms.example.com/api/health?x=1');
  });

  it('ignores forwarded headers by default, since any client can send them', async () => {
    const url = await serveEcho();
    const seen = await fetch(`${url}/api/health`, { headers: forwarded }).then(r => r.text());
    expect(seen).toBe(`${url}/api/health`);
  });

  it('ignores forwarded headers from a peer outside the trusted ranges', async () => {
    const url = await serveEcho(['10.0.0.0/8']);
    const seen = await fetch(`${url}/api/health`, { headers: forwarded }).then(r => r.text());
    expect(seen).toBe(`${url}/api/health`);
  });

  it('refuses an entry that is not an address or range', () => {
    expect(() =>
      layerFetchServer({ fetch: () => Promise.resolve(new Response()), port: 0, trustedProxies: ['10.0.0.1/8'] })
    )
      .toThrow(/"10\.0\.0\.1\/8" is not an IP address or CIDR range \(address has non-zero host bits\)/);
  });
});

describe('parseTrustedProxy', () => {
  it('takes CIDR ranges as given and single addresses as one-address ranges', () => {
    expect(IpNetwork.format(parseTrustedProxy('172.16.0.0/12'))).toBe('172.16.0.0/12');
    expect(IpNetwork.format(parseTrustedProxy(' 10.0.0.7 '))).toBe('10.0.0.7/32');
    expect(IpNetwork.format(parseTrustedProxy('::1'))).toBe('::1/128');
  });

  it('reads an IPv4-mapped IPv6 address as the IPv4 address peers are matched as', () => {
    expect(IpNetwork.format(parseTrustedProxy('::ffff:10.0.0.7'))).toBe('10.0.0.7/32');
  });

  it('names the entry and the reason when it does not parse', () => {
    expect(() => parseTrustedProxy('proxy.internal')).toThrow(
      /^"proxy\.internal" is not an IP address or CIDR range \(/,
    );
  });
});

describe('resolveServeBackend', () => {
  const none = { _tag: 'None' } as const;
  const some = (value: string) => ({ _tag: 'Some', value }) as const;

  it('defaults to the fs driver rooted at --root', () => {
    expect(
      resolveServeBackend('contentia', { backend: none, backendOptions: none, root: '/c', defaultExtension: 'yaml' }),
    )
      .toEqual({ backend: 'fs', options: { root: '/c', defaultExtension: 'yaml' } });
  });

  it('uses --backend with its parsed --backend-options', () => {
    expect(
      resolveServeBackend('contentia', {
        backend: some('s3'),
        backendOptions: some('{"bucket":"b"}'),
        root: '/ignored',
        defaultExtension: 'md',
      }),
    ).toEqual({ backend: 's3', options: { bucket: 'b' } });
  });

  it('rejects --backend-options without --backend instead of silently serving fs', () => {
    expect(() =>
      resolveServeBackend('contentia', {
        backend: none,
        backendOptions: some('{}'),
        root: '/c',
        defaultExtension: 'md',
      })
    ).toThrow('--backend-options needs --backend');
  });

  it('rejects options that are not a JSON object', () => {
    expect(() =>
      resolveServeBackend('contentia', {
        backend: some('s3'),
        backendOptions: some('[1]'),
        root: '/c',
        defaultExtension: 'md',
      })
    ).toThrow('--backend-options must be a JSON object');
  });
});
