import { NodeHttpServer } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServer from 'effect/http/HttpServer';
import type * as HttpServerError from 'effect/http/HttpServerError';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Layer from 'effect/Layer';
import { createServer } from 'node:http';

import { allowAll } from 'contentia/json-api';
import type { StorageRepository } from 'contentia/storage';
import { buildJsonApi } from 'contentia/storage-api';

import { bearerTokenMatches } from './auth.js';

export interface StorageServerOptions {
  /**
   * The repository to expose. Build one with `buildStorageRepository` from the
   * driver registry (`fs`, `s3`, `github`, ...) or construct it directly.
   */
  repository: StorageRepository;
  /** Listen port. `0` picks a free port; read it back via `onListening`. */
  port: number;
  /** Listen host. Defaults to `127.0.0.1`. */
  host?: string;
  /** If set, require `Authorization: Bearer <token>` on every request. */
  authToken?: string;
  /**
   * Called once the socket is bound, with the base URL clients should use.
   * This is the only way to learn the real port when `port` is `0`.
   */
  onListening?: (url: string) => Effect.Effect<void>;
}

/**
 * Bearer-token gate baked into the catch-all route. No-op when `token` is
 * undefined.
 */
const checkAuth = (
  request: HttpServerRequest.HttpServerRequest,
  token: string | undefined,
): HttpServerResponse.HttpServerResponse | undefined => {
  if (!token) return undefined;
  if (bearerTokenMatches(request.headers.authorization, token)) return undefined;
  return HttpServerResponse.jsonUnsafe(
    { errors: [{ status: '401', title: 'Unauthorized' }] },
    { status: 401 },
  );
};

/**
 * Build the Layer for the catch-all route that forwards every request into
 * contentia's JSON:API handler. The handler is `(Request) => Promise<Response>`,
 * so we convert at the boundary with `HttpServerRequest.toWeb` /
 * `HttpServerResponse.fromWeb`.
 */
const buildRoutes = (options: StorageServerOptions) => {
  // `checkAuth` below is this server's access decision — it runs on every
  // route before the handler is reached, so the handler itself allows all.
  const api = buildJsonApi({ repo: options.repository, logger: console, authorize: allowAll });

  return HttpRouter.add(
    '*',
    '/*',
    Effect.fn('storage-api.handle')(function*(request: HttpServerRequest.HttpServerRequest) {
      const denied = checkAuth(request, options.authToken);
      if (denied) return denied;
      const webReq = yield* HttpServerRequest.toWeb(request);
      const webRes = yield* Effect.promise(() => api.fetch(webReq));
      return HttpServerResponse.fromWeb(webRes);
    }),
  );
};

/**
 * Layer that runs the JSON:API storage server until interrupted.
 *
 * Compose with `Layer.launch` (or `NodeRuntime.runMain` of a workflow that
 * depends on this layer).
 */
export const layerStorageServer = (
  options: StorageServerOptions,
): Layer.Layer<never, HttpServerError.ServeError> => {
  const host = options.host ?? '127.0.0.1';
  const App = Layer.mergeAll(buildRoutes(options), HttpRouter.cors());
  // `onListening` replaces the router's own "Listening on" log line.
  return Layer.mergeAll(
    HttpRouter.serve(App, { disableListenLog: options.onListening !== undefined }),
    layerOnListening(host, options.onListening),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: options.port, host })),
  );
};

export interface FetchServerOptions {
  /** A Fetch API handler, e.g. `contentiaApi(...).fetch`. It owns auth and CORS. */
  fetch: (request: Request) => Promise<Response>;
  /** Listen port. `0` picks a free port; read it back via `onListening`. */
  port: number;
  /** Listen host. Defaults to `127.0.0.1`. */
  host?: string;
  /** Called once the socket is bound, with the base URL clients should use. */
  onListening?: (url: string) => Effect.Effect<void>;
}

/**
 * Layer that serves a Fetch API handler on Node until interrupted. Unlike
 * {@link layerStorageServer} it adds no auth or CORS of its own.
 */
export const layerFetchServer = (
  options: FetchServerOptions,
): Layer.Layer<never, HttpServerError.ServeError> => {
  const host = options.host ?? '127.0.0.1';
  const Routes = HttpRouter.add(
    '*',
    '/*',
    Effect.fn('fetch-server.handle')(function*(request: HttpServerRequest.HttpServerRequest) {
      const webReq = yield* HttpServerRequest.toWeb(request);
      const webRes = yield* Effect.promise(() => options.fetch(webReq));
      return HttpServerResponse.fromWeb(webRes);
    }),
  );
  return Layer.mergeAll(
    HttpRouter.serve(Routes, { disableListenLog: options.onListening !== undefined }),
    layerOnListening(host, options.onListening),
  ).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: options.port, host })),
  );
};

/** Report the bound URL once the socket is listening; a no-op without a callback. */
const layerOnListening = (
  host: string,
  onListening: ((url: string) => Effect.Effect<void>) | undefined,
): Layer.Layer<never, never, HttpServer.HttpServer> =>
  onListening
    ? Layer.effectDiscard(Effect.gen(function*() {
      const { address } = yield* HttpServer.HttpServer;
      // The bound IP is what the socket reports (e.g. `::1`); the host the
      // caller asked for is the one clients can actually dial.
      const url = address._tag !== 'UnixPathAddress'
        ? `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
        : HttpServer.formatAddress(address);
      yield* onListening(url);
    }))
    : Layer.empty;
