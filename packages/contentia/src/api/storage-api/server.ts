import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as S from 'effect/Schema';

import type { ContentiaResult, ErrorStatus } from 'contentia/core';
import {
  type ContentiaDone,
  ContentiaError,
  ContentiaStream,
  ContentiaTask,
  ErrorCodeToStatusMap,
  InternalError,
  InvalidData,
  NotFoundError,
} from 'contentia/core';
import type { AuthorizeDecision, JsonApiError, JsonApiLogger, JsonApiResponse } from 'contentia/json-api';
import {
  errorToJsonApiMapper,
  openApiDocumentToYaml,
  recoverableErrorsToWarnings,
  resolveAuthorization,
} from 'contentia/json-api';
import type {
  Atom,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
} from 'contentia/storage';

import {
  atomSummaryToJsonApi,
  atomToJsonApi,
  buildPaginationLinks,
  folderToJsonApi,
  type JsonApiCollectionResponse,
  type JsonApiResource,
  parsePaginationQuery,
  STORAGE_API_VERSION,
  storageObjectToJsonApi,
  withSelfLink,
} from './jsonapi.js';

// The spec is a large static object literal that only the two openapi routes
// ever read, so it is loaded on demand rather than statically imported: a
// deployment that never serves it keeps it out of the startup path, and
// bundlers can split it into a chunk of its own instead of inlining it into
// every worker that mounts this handler.
const loadOpenApiBuilder = async () => (await import('./openapi.js')).buildStorageOpenApi;

type AllJsonApiResponses = JsonApiResponse | JsonApiCollectionResponse | JsonApiError;

interface AtomicResults {
  'atomic:results': Array<{ data?: JsonApiResource, errors?: JsonApiError['errors'] } | undefined>;
}

const json = <T extends AllJsonApiResponses | AtomicResults>(body: T, status: number = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/vnd.api+json',
      'Cache-Control': 'no-store',
    },
  });

// decodeURIComponent throws on malformed sequences; degrade to the raw segment
// rather than 500ing on bad input — downstream validation will reject anything
// the storage layer can't handle.
const safeDecode = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

function respondError(result: ContentiaResult<unknown>, status: ErrorStatus = 400, logger?: JsonApiLogger) {
  if (Result.isSuccess(result)) throw new InternalError('respondError called with success result');
  return json(errorToJsonApiMapper(result, logger), status);
}

/** The HTTP status for a repository failure: mapped from its error code, 500 when the code is unknown. */
const mappedStatus = (error: ContentiaError): ErrorStatus =>
  ErrorCodeToStatusMap[error.code as keyof typeof ErrorCodeToStatusMap] ?? 500;

type ListPagination = ReturnType<typeof parsePaginationQuery>;

/**
 * Pagination for a listing request with no `page[*]` key: the first page of
 * 100. The spec documents this default (`DEFAULT_PAGE_SIZE` in openapi.ts).
 */
const DEFAULT_LIST_PAGINATION: ListPagination = { page: 1, perPage: 100 };

/** Resources addressed as `/{resource}/{key}`, where the key must be one percent-encoded path segment. */
const KEYED_RESOURCES = new Set(['atoms', 'atom-summaries', 'atom', 'objects', 'folders']);

function respondResourceWithConverter<T, R extends JsonApiResource>(
  result: ContentiaResult<T>,
  converter: (data: T) => R,
  basePath: string,
  recoverableErrors?: ReadonlyArray<ContentiaError>,
  status: number = 200,
  logger?: JsonApiLogger,
) {
  if (Result.isFailure(result)) return respondError(result, undefined, logger);
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  return json({
    data: withSelfLink(converter(result.success), basePath),
    ...(warnings ? { meta: { warnings } } : {}),
  }, status);
}

function respondCollectionWithConverter<T, R extends JsonApiResource>(
  pagination: ListPagination,
  items: readonly T[],
  converter: (item: T) => R,
  baseUrl: string,
  basePath: string,
  done?: ContentiaDone,
  recoverableErrors?: ReadonlyArray<ContentiaError>,
) {
  let firstCursor: string | undefined;
  let lastCursor: string | undefined;

  if (items.length > 0) {
    const firstItem = items[0] as { id?: string, key?: string };
    const lastItem = items[items.length - 1] as { id?: string, key?: string };
    firstCursor = firstItem.id || firstItem.key;
    lastCursor = lastItem.id || lastItem.key;
  }

  // `hasMore` is best-effort: prefer the upstream Done's pagination hint
  // when present, otherwise infer from "more items than requested".
  const requestedLimit = 'limit' in pagination
    ? pagination.limit
    : ('perPage' in pagination ? pagination.perPage : undefined);
  const hasMore = done?.pagination !== undefined
    || (typeof done?.total === 'number' && typeof requestedLimit === 'number'
      ? items.length === requestedLimit
      : false);

  const links = buildPaginationLinks(baseUrl, pagination, hasMore, lastCursor, firstCursor, lastCursor);

  // `meta.page` carries aggregate counts; `meta.warnings` carries per-item
  // recoverable errors collected during the stream (so the response stays
  // 200 OK with partial data + an explicit list of what didn't work).
  const warnings = recoverableErrors ? recoverableErrorsToWarnings(recoverableErrors) : undefined;
  const page = typeof done?.total === 'number' ? { total: done.total } : undefined;
  const meta = page || warnings ? { ...(page ? { page } : {}), ...(warnings ? { warnings } : {}) } : undefined;

  const response: JsonApiCollectionResponse = {
    data: items.map(item => withSelfLink(converter(item), basePath)),
    links,
    ...(meta ? { meta } : {}),
  };

  return json(response);
}

/** Convert any caught throw into a ContentiaError, preserving ContentiaError instances and wrapping defects in InternalError. */
const toContentiaError = (err: unknown): ContentiaError => {
  if (err instanceof ContentiaError) return err;
  if (err instanceof Error) return new InternalError(err.message, { cause: err });
  return new InternalError(String(err));
};

/**
 * Run a ContentiaTask and surface the resolved value as a ContentiaResult. Catches
 * both typed failures AND defects so route handlers always produce a
 * JSON:API response instead of leaking text/plain 500s.
 */
const runTask = async <T>(task: ContentiaTask.ContentiaTask<T>): Promise<ContentiaResult<T>> => {
  try {
    return await Effect.runPromise(Effect.result(ContentiaTask.runValue(task)));
  } catch (err) {
    return Result.fail(toContentiaError(err));
  }
};

/**
 * Like {@link runTask} but preserves any ContentiaTask recoverableErrors so the
 * caller can surface them as `meta.warnings` on a single-resource response —
 * needed for the create/update routes where the backing impl may emit
 * recoverable warnings (e.g. R2 readback fallback after a write).
 */
const runTaskWithMetadata = async <T>(
  task: ContentiaTask.ContentiaTask<T>,
): Promise<ContentiaResult<{ value: T, recoverableErrors: ReadonlyArray<ContentiaError> }>> => {
  try {
    const r = await Effect.runPromise(Effect.result(ContentiaTask.runCollect(task)));
    if (Result.isFailure(r)) return Result.fail(r.failure);
    return Result.succeed({ value: r.success.value, recoverableErrors: r.success.recoverableErrors });
  } catch (err) {
    return Result.fail(toContentiaError(err));
  }
};

/** Run a ContentiaStream and collect data + recoverable errors + done as a ContentiaResult. Catches defects, same as {@link runTask}. */
const runStream = async <A, D extends ContentiaDone>(
  stream: ContentiaStream.ContentiaStream<A, D>,
): Promise<
  ContentiaResult<{
    data: ReadonlyArray<A>,
    recoverableErrors: ReadonlyArray<ContentiaError>,
    done: D,
  }>
> => {
  try {
    return await Effect.runPromise(Effect.result(ContentiaStream.runCollect(stream)));
  } catch (err) {
    return Result.fail(toContentiaError(err));
  }
};

const JsonApiStorageObjectCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
  // Resource-level meta — surfaces StorageObject.metadata (extension,
  // revisionId, …) without polluting `attributes`.
  meta: S.optional(S.Record(S.String, S.Any)),
}));

const JsonApiStorageObjectUpdateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('object'),
  id: S.String,
  attributes: S.Struct({
    type: S.optional(S.Literal('object')),
    content: S.optional(S.Record(S.String, S.Any)),
  }),
  meta: S.optional(S.Record(S.String, S.Any)),
}));

const JsonApiFolderCreateSchema = S.toStandardSchemaV1(S.Struct({
  type: S.Literal('folder'),
  id: S.String,
  attributes: S.Struct({ type: S.optional(S.Literal('folder')) }),
}));

const StorageObjectCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectCreateSchema,
}));
const StorageObjectUpdateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiStorageObjectUpdateSchema,
}));

const RemoveOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('remove'),
  ref: S.Struct({
    type: S.Union([S.Literal('object'), S.Literal('folder'), S.Literal('atom')]),
    id: S.String,
  }),
}));
const AddOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('add'),
  data: S.Union([JsonApiStorageObjectCreateSchema, JsonApiFolderCreateSchema]),
}));
const UpdateOperationSchema = S.toStandardSchemaV1(S.Struct({
  op: S.Literal('update'),
  data: JsonApiStorageObjectUpdateSchema,
}));
const AtomicOperationSchema = S.Union([RemoveOperationSchema, AddOperationSchema, UpdateOperationSchema]);
const AtomicOperationsRequestSchema = S.toStandardSchemaV1(S.Struct({
  'atomic:operations': S.Array(AtomicOperationSchema),
}));

const FolderCreateBodySchema = S.toStandardSchemaV1(S.Struct({
  data: JsonApiFolderCreateSchema,
}));

/**
 * The set of attribute keys that are valid on a storage object resource.
 * Any key outside this set indicates the caller likely misplaced their data
 * (e.g. sent `attributes.title` instead of `attributes.content.title`).
 */
const ALLOWED_STORAGE_OBJECT_ATTRIBUTE_KEYS = new Set(['type', 'content']);

/**
 * Returns the first unknown key found in `rawBody.data.attributes`, or
 * `undefined` if all keys are recognized. Used to surface a friendly 400
 * before the schema decoder silently strips the unknown keys.
 */
const getUnknownAttributeKey = (rawBody: unknown): string | undefined => {
  if (
    typeof rawBody !== 'object' || rawBody === null
    || !('data' in rawBody) || typeof (rawBody as { data: unknown }).data !== 'object'
    || (rawBody as { data: unknown }).data === null
  ) return undefined;

  const data = (rawBody as { data: Record<string, unknown> }).data;
  if (!('attributes' in data) || typeof data.attributes !== 'object' || data.attributes === null) {
    return undefined;
  }

  for (const key of Object.keys(data.attributes as Record<string, unknown>)) {
    if (!ALLOWED_STORAGE_OBJECT_ATTRIBUTE_KEYS.has(key)) return key;
  }
  return undefined;
};

type StorageObjectCreateBody = S.Schema.Type<typeof StorageObjectCreateBodySchema>;
type StorageObjectUpdateBody = S.Schema.Type<typeof StorageObjectUpdateBodySchema>;
type FolderCreateBody = S.Schema.Type<typeof FolderCreateBodySchema>;
type AtomicOperation = S.Schema.Type<typeof AtomicOperationSchema>;
type AtomicOperationsRequest = S.Schema.Type<typeof AtomicOperationsRequestSchema>;

/**
 * A single storage action the API is about to perform, discriminated on
 * `action` and carrying that action's direct arguments (the same values passed
 * to the underlying {@link StorageRepository} method). Atomic-operation
 * sub-steps are surfaced individually via their granular action (e.g. an
 * `add` op with an object becomes `createObject`).
 */
export type StorageAuthorizeAction =
  | { action: 'readOpenApi', format: 'json' | 'yaml' }
  | { action: 'getCapabilities' }
  | { action: 'listAtoms', key: string, options: NonNullable<Parameters<StorageRepository['listAtoms']>[1]> }
  | {
    action: 'listAtomSummaries',
    key: string,
    options: NonNullable<Parameters<StorageRepository['listAtomSummaries']>[1]>,
  }
  | { action: 'getObject', key: string }
  | { action: 'getFolder', key: string }
  | { action: 'getAtom', key: string }
  | { action: 'createObject', data: StorageObjectCreate }
  | { action: 'createFolder', data: FolderCreate }
  | { action: 'updateObject', data: StorageObjectUpdate }
  | { action: 'removeObject', key: string };

/**
 * The argument passed to a storage {@link StorageAuthorize} callback: the
 * action descriptor plus the entire originating {@link Request}.
 */
export type StorageAuthorizeInput = StorageAuthorizeAction & { request: Request };

/**
 * Per-action authorization callback. Invoked once for every storage action
 * (and once per sub-operation of an atomic request) before the underlying
 * repository is touched. Return `true` to allow, `false` to deny with a 403,
 * or a `ContentiaError` to deny with a custom status/message.
 */
export type StorageAuthorize = (input: StorageAuthorizeInput) => AuthorizeDecision | Promise<AuthorizeDecision>;

export interface StorageApiOptions {
  repo: StorageRepository;
  basePath?: string | undefined;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
  /**
   * Per-action authorization hook. Required: there is no implicit default,
   * because an API that silently defaults to open is the failure mode this
   * option exists to prevent. Pass `allowAll` to state that a surface is
   * intentionally unauthenticated. See {@link StorageAuthorize}.
   */
  authorize: StorageAuthorize;
}

/**
 * Build a JSON:API handler for the storage repository.
 *
 * ⚠️ This handler ships no authentication. Wrap it before exposing it to an
 * untrusted network.
 */
export function buildJsonApi(options: StorageApiOptions) {
  const { repo, basePath = '', onError, logger, authorize } = options;

  const decodeStorageObjectCreateBody = S.decodeUnknownSync(StorageObjectCreateBodySchema);
  const decodeStorageObjectUpdateBody = S.decodeUnknownSync(StorageObjectUpdateBodySchema);
  const decodeFolderCreateBody = S.decodeUnknownSync(FolderCreateBodySchema);
  const decodeAtomicOperationsRequest = S.decodeUnknownSync(AtomicOperationsRequestSchema);

  /** Notify onError and delegate to respondError. */
  const failResponse = (result: ContentiaResult<unknown>, status?: ErrorStatus): Response => {
    if (Result.isFailure(result)) onError?.(result.failure);
    return respondError(result, status, logger);
  };

  /**
   * Remove a single key. Whether it was removed is read from `done.removed`,
   * not from the emitted keys: a backend may report a removed key under its
   * on-disk path (`del-test.md` for `del-test`). A single-key call is also the
   * only way to tie the repository's warnings to a key, since they carry none.
   */
  const removeOne = async (
    key: string,
  ): Promise<ContentiaResult<{ removed: boolean, recoverableErrors: ReadonlyArray<ContentiaError> }>> => {
    const result = await runStream(repo.removeAtoms([key]));
    if (Result.isFailure(result)) return Result.fail(result.failure);
    return Result.succeed({
      removed: result.success.done.removed > 0,
      recoverableErrors: result.success.recoverableErrors,
    });
  };

  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await fetchInner(request);
      } catch (err) {
        onError?.(err);
        return respondError(Result.fail(toContentiaError(err)), 500, logger);
      }
    },
  };

  async function fetchInner(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Run the per-action authorization hook (if configured). Returns a ready
    // error Response when the action is denied, or `null` when it's allowed.
    const authorizeAction = async (action: StorageAuthorizeAction): Promise<Response | null> => {
      const denial = resolveAuthorization(await authorize({ ...action, request }));
      if (!denial) return null;
      const status = ErrorCodeToStatusMap[denial.code as keyof typeof ErrorCodeToStatusMap] ?? 403;
      return failResponse(Result.fail(denial), status);
    };
    let path = url.pathname.substring(basePath.length);
    if (path.startsWith('/')) path = path.substring(1);
    if (path.endsWith('/')) path = path.slice(0, -1);

    if (path === '' && request.method === 'GET') {
      return json({
        data: {
          type: 'api-info',
          id: 'storage',
          attributes: {
            name: 'Storage API',
            version: STORAGE_API_VERSION,
            endpoints: [
              {
                path: '/openapi.json',
                methods: ['GET'],
                description: 'OpenAPI 3.1 specification for this API',
              },
              {
                path: '/openapi.yaml',
                methods: ['GET'],
                description: 'OpenAPI 3.1 specification for this API, as YAML',
              },
              {
                path: '/capabilities',
                methods: ['GET'],
                description: 'Underlying storage repository capabilities',
              },
              {
                path: '/atoms',
                methods: ['GET', 'POST'],
                description: 'List atoms in the root folder, or create a folder',
              },
              { path: '/atoms/{key}', methods: ['GET'], description: 'List atoms in a folder' },
              { path: '/atom/{key}', methods: ['GET'], description: 'Read a single atom (object or folder)' },
              {
                path: '/atom-summaries',
                methods: ['GET'],
                description: 'List atom summaries (lightweight listing) in the root folder',
              },
              {
                path: '/atom-summaries/{key}',
                methods: ['GET'],
                description: 'List atom summaries (lightweight listing) in a folder',
              },
              {
                path: '/objects',
                methods: ['POST'],
                description: 'Create a storage object',
              },
              {
                path: '/objects/{key}',
                methods: ['GET', 'PATCH', 'DELETE'],
                description: 'Read, update, or delete a storage object',
              },
              { path: '/folders/{key}', methods: ['GET'], description: 'Read a folder' },
              {
                path: '/operations',
                methods: ['POST'],
                description: 'Atomic operations (add, update, remove)',
              },
            ],
          },
        },
      });
    }

    if (path === 'openapi.json' && request.method === 'GET') {
      const denied = await authorizeAction({ action: 'readOpenApi', format: 'json' });
      if (denied) return denied;
      const doc = (await loadOpenApiBuilder())({ basePath });
      return new Response(
        JSON.stringify({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    if (path === 'openapi.yaml' && request.method === 'GET') {
      const denied = await authorizeAction({ action: 'readOpenApi', format: 'yaml' });
      if (denied) return denied;
      const doc = (await loadOpenApiBuilder())({ basePath });
      const yaml = openApiDocumentToYaml({ ...doc, servers: [{ url: `${url.origin}${basePath}` }] });
      return new Response(yaml, {
        status: 200,
        headers: {
          'Content-Type': 'application/yaml',
          'Cache-Control': 'no-store',
        },
      });
    }

    // A key is one path segment, so a slash in it arrives percent-encoded as
    // %2F (the JSON-API proxy always encodes keys); decode it back here.
    const [resource = '', rawKey, ...extraSegments] = path.split('/');
    const key = rawKey === undefined ? undefined : safeDecode(rawKey);

    // Acting on the first segment of `/objects/posts/hello-world` would read,
    // or delete, `posts`, so a keyed route with extra segments is rejected.
    if (extraSegments.length > 0 && KEYED_RESOURCES.has(resource)) {
      const intendedKey = [rawKey, ...extraSegments].map(safeDecode).join('/');
      return failResponse(
        Result.fail(
          new InvalidData(
            `/${resource}/{key} takes the key as a single path segment, but the URL has more. `
              + `Percent-encode each slash in the key as %2F: /${resource}/${encodeURIComponent(intendedKey)}`,
          ),
        ),
        400,
      );
    }

    // Returns a 400 response if the client requested cursor pagination but the
    // backend has declared it unsupported in its capabilities. Returns null
    // when cursor pagination is either not requested or is supported.
    const rejectUnsupportedCursor = async (queryParams: Record<string, string>): Promise<Response | null> => {
      const hasAfter = queryParams['page[after]'] !== undefined;
      const hasBefore = queryParams['page[before]'] !== undefined;
      if (!hasAfter && !hasBefore) return null;
      const capsResult = await runTask(repo.getCapabilities());
      if (Result.isFailure(capsResult)) return null; // can't check; let the list proceed
      const caps = capsResult.success;
      const cursorSupported = caps.pagination.supported && caps.pagination.styles.cursor;
      if (cursorSupported) return null;
      return failResponse(
        Result.fail(
          new InvalidData(
            'Cursor pagination (page[after] / page[before]) is not supported by this storage backend. '
              + 'Use page[number] / page[size] or page[offset] / page[limit] instead. '
              + 'Consult GET /capabilities for the pagination modes this backend supports.',
          ),
        ),
        400,
      );
    };

    const listFullAtoms = async () => {
      const queryParams = Object.fromEntries(url.searchParams.entries());
      if (queryParams['filter[prefix]'] !== undefined && key === undefined) {
        return failResponse(
          Result.fail(
            new InvalidData(
              '`filter[prefix]` is not a supported query parameter. '
                + 'To list atoms under a prefix, include the key in the URL path: GET /atoms/{key}',
            ),
          ),
          400,
        );
      }
      const cursorRejection = await rejectUnsupportedCursor(queryParams);
      if (cursorRejection) return cursorRejection;
      const hasPaginationParam = Object.keys(queryParams).some(k => k.startsWith('page['));
      const pagination = hasPaginationParam ? parsePaginationQuery(queryParams) : DEFAULT_LIST_PAGINATION;
      const rawDepth = parseInt(queryParams['filter[depth]'] ?? '1', 10);
      const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? rawDepth : 1;
      const listOptions = { depth, pagination };
      const denied = await authorizeAction({ action: 'listAtoms', key: key ?? '', options: listOptions });
      if (denied) return denied;
      const result = await runStream(repo.listAtoms(key ?? '', listOptions));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondCollectionWithConverter(
        pagination,
        result.success.data,
        atomToJsonApi,
        `${url.origin}${url.pathname}`,
        basePath,
        result.success.done,
        result.success.recoverableErrors,
      );
    };

    const listAtomSummaries = async () => {
      const queryParams = Object.fromEntries(url.searchParams.entries());
      if (queryParams['filter[prefix]'] !== undefined && key === undefined) {
        return failResponse(
          Result.fail(
            new InvalidData(
              '`filter[prefix]` is not a supported query parameter. '
                + 'To list atom summaries under a prefix, include the key in the URL path: GET /atom-summaries/{key}',
            ),
          ),
          400,
        );
      }
      const cursorRejection = await rejectUnsupportedCursor(queryParams);
      if (cursorRejection) return cursorRejection;
      const hasPaginationParam = Object.keys(queryParams).some(k => k.startsWith('page['));
      const pagination = hasPaginationParam ? parsePaginationQuery(queryParams) : DEFAULT_LIST_PAGINATION;
      const rawDepth = parseInt(queryParams['filter[depth]'] ?? '1', 10);
      const depth = Number.isFinite(rawDepth) && rawDepth >= 1 ? rawDepth : 1;
      const listOptions = { depth, pagination };
      const denied = await authorizeAction({ action: 'listAtomSummaries', key: key ?? '', options: listOptions });
      if (denied) return denied;
      const result = await runStream(repo.listAtomSummaries(key ?? '', listOptions));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondCollectionWithConverter(
        pagination,
        result.success.data,
        atomSummaryToJsonApi,
        `${url.origin}${url.pathname}`,
        basePath,
        result.success.done,
        result.success.recoverableErrors,
      );
    };

    if (path === 'capabilities' && request.method === 'GET') {
      // Surface the underlying repository's `Capabilities` so proxy clients
      // (and humans) can introspect what's actually supported instead of
      // assuming. Cheap call; we run it on every request so a swapped-out
      // repo is reflected immediately.
      const denied = await authorizeAction({ action: 'getCapabilities' });
      if (denied) return denied;
      const result = await runTask(repo.getCapabilities());
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return json({
        data: {
          type: 'storage-capabilities',
          id: 'self',
          attributes: result.success,
          links: { self: `${basePath}/capabilities` },
        },
      });
    }
    if (resource === 'atoms' && request.method === 'GET') return listFullAtoms();
    else if (path === 'atoms' && request.method === 'POST') {
      let body: FolderCreateBody;
      try {
        const rawBody = await request.json();
        body = decodeFolderCreateBody(rawBody);
      } catch {
        return failResponse(Result.fail(new InvalidData('Invalid request body')), 400);
      }
      if (!body.data.id) {
        return failResponse(
          Result.fail(new InvalidData('data.id is required and must be a non-empty key')),
          400,
        );
      }
      const data: FolderCreate = { key: body.data.id, type: 'folder' };
      const denied = await authorizeAction({ action: 'createFolder', data });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.createFolder(data));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        folderToJsonApi,
        basePath,
        result.success.recoverableErrors,
        201,
      );
    } else if (resource === 'atom-summaries' && request.method === 'GET') return listAtomSummaries();
    else if (resource === 'atom' && request.method === 'GET') {
      if (!key) return failResponse(Result.fail(new InvalidData('Missing atom key')), 400);
      const denied = await authorizeAction({ action: 'getAtom', key });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.getAtom(key));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        (atom: Atom) => atomToJsonApi(atom),
        basePath,
        result.success.recoverableErrors,
      );
    } else if (resource === 'objects' && request.method === 'GET') {
      if (!key) return failResponse(Result.fail(new InvalidData('Missing object key')), 400);
      const denied = await authorizeAction({ action: 'getObject', key });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.getObject(key));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        storageObjectToJsonApi,
        basePath,
        result.success.recoverableErrors,
      );
    } else if (resource === 'folders' && request.method === 'GET') {
      if (!key) return failResponse(Result.fail(new InvalidData('Missing folder key')), 400);
      const denied = await authorizeAction({ action: 'getFolder', key });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.getFolder(key));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        folderToJsonApi,
        basePath,
        result.success.recoverableErrors,
      );
    } else if (path === 'objects' && request.method === 'POST') {
      let body: StorageObjectCreateBody;
      try {
        const rawBody = await request.json();
        const unknownAttrKey = getUnknownAttributeKey(rawBody);
        if (unknownAttrKey !== undefined) {
          return failResponse(
            Result.fail(
              new InvalidData(
                `Unknown attribute key "${unknownAttrKey}" in data.attributes. `
                  + 'Only "content" and "type" are allowed — did you mean to nest your data under "content"?',
              ),
            ),
            400,
          );
        }
        body = decodeStorageObjectCreateBody(rawBody);
      } catch {
        return failResponse(Result.fail(new InvalidData('Invalid request body')), 400);
      }
      if (!body.data.id) {
        return failResponse(
          Result.fail(new InvalidData('data.id is required and must be a non-empty key')),
          400,
        );
      }
      const data: StorageObjectCreate = {
        key: body.data.id,
        type: 'object',
        content: body.data.attributes.content || {},
        ...(body.data.meta ? { metadata: body.data.meta } : {}),
      };
      const denied = await authorizeAction({ action: 'createObject', data });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.createObject(data));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        storageObjectToJsonApi,
        basePath,
        result.success.recoverableErrors,
        201,
      );
    }

    if (resource === 'objects' && request.method === 'PATCH') {
      let body: StorageObjectUpdateBody;
      try {
        const rawBody = await request.json();
        const unknownAttrKey = getUnknownAttributeKey(rawBody);
        if (unknownAttrKey !== undefined) {
          return failResponse(
            Result.fail(
              new InvalidData(
                `Unknown attribute key "${unknownAttrKey}" in data.attributes. `
                  + 'Only "content" and "type" are allowed — did you mean to nest your data under "content"?',
              ),
            ),
            400,
          );
        }
        body = decodeStorageObjectUpdateBody(rawBody);
      } catch {
        return failResponse(Result.fail(new InvalidData('Invalid request body')), 400);
      }
      if (body.data.id !== key) {
        return failResponse(
          Result.fail(new InvalidData('Key in URL does not match key in body')),
          ErrorCodeToStatusMap[InvalidData.CODE],
        );
      }
      const data: StorageObjectUpdate = {
        key: body.data.id,
        type: 'object',
        content: body.data.attributes.content,
        ...(body.data.meta ? { metadata: body.data.meta } : {}),
      };
      const denied = await authorizeAction({ action: 'updateObject', data });
      if (denied) return denied;
      const result = await runTaskWithMetadata(repo.updateObject(data));
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      return respondResourceWithConverter(
        Result.succeed(result.success.value),
        storageObjectToJsonApi,
        basePath,
        result.success.recoverableErrors,
      );
    } else if (resource === 'objects' && request.method === 'DELETE') {
      if (!key) {
        return failResponse(Result.fail(new InvalidData('Missing object key')), 400);
      }
      const denied = await authorizeAction({ action: 'removeObject', key });
      if (denied) return denied;
      const result = await removeOne(key);
      if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
      if (!result.success.removed) {
        return failResponse(Result.fail(new NotFoundError(`Object not found: ${key}`)), 404);
      }
      const warnings = recoverableErrorsToWarnings(result.success.recoverableErrors);
      return json(
        { meta: { deleted: true, ...(warnings ? { warnings } : {}) } } as unknown as JsonApiResponse,
      );
    } else if (resource === 'objects' && key !== undefined) {
      // Known path, unsupported method (PUT, POST, …): 405 is more accurate than 404.
      const hint = request.method === 'POST' ? ' To create an object, POST /objects with the key in data.id.' : '';
      return new Response(
        JSON.stringify({
          errors: [
            {
              status: '405',
              code: 'method_not_allowed',
              title: 'Method Not Allowed',
              detail: `${request.method} is not supported on /objects/{key}. Allowed: GET, PATCH, DELETE.${hint}`,
            },
          ],
        }),
        {
          status: 405,
          headers: {
            Allow: 'GET, PATCH, DELETE',
            'Content-Type': 'application/vnd.api+json',
            'Cache-Control': 'no-store',
          },
        },
      );
    } else if (path === 'operations' && request.method === 'POST') {
      let body: AtomicOperationsRequest;
      try {
        const rawBody = await request.json();
        if (
          typeof rawBody === 'object' && rawBody !== null
          && 'atomic:operations' in rawBody
          && Array.isArray((rawBody as { 'atomic:operations': unknown })['atomic:operations'])
        ) {
          for (const op of (rawBody as { 'atomic:operations': unknown[] })['atomic:operations']) {
            // Folder attributes are lenient, as on POST /atoms: the key rule
            // exists to catch object content placed outside `content`.
            if (
              typeof op === 'object' && op !== null
              && 'op' in op && ((op as { op: unknown }).op === 'add' || (op as { op: unknown }).op === 'update')
              && 'data' in op
              && (op as { data: { type?: unknown } | null }).data?.type !== 'folder'
            ) {
              const unknownAttrKey = getUnknownAttributeKey(
                { data: (op as { data: unknown }).data },
              );
              if (unknownAttrKey !== undefined) {
                return failResponse(
                  Result.fail(
                    new InvalidData(
                      `Unknown attribute key "${unknownAttrKey}" in data.attributes. `
                        + 'Only "content" and "type" are allowed — did you mean to nest your data under "content"?',
                    ),
                  ),
                  400,
                );
              }
            }
          }
        }
        body = decodeAtomicOperationsRequest(rawBody);
      } catch {
        return failResponse(
          Result.fail(new InvalidData('Invalid atomic operations request')),
          400,
        );
      }

      // Authorize every sub-operation up front, mapped to its granular action.
      // Atomic requests are all-or-nothing: a single denial rejects the whole
      // batch before any write reaches the repository.
      for (const operation of body['atomic:operations']) {
        let action: StorageAuthorizeAction | undefined;
        if (operation.op === 'add' && operation.data.type === 'object') {
          action = {
            action: 'createObject',
            data: {
              key: operation.data.id,
              type: 'object',
              content: operation.data.attributes.content || {},
            },
          };
        } else if (operation.op === 'add' && operation.data.type === 'folder') {
          action = { action: 'createFolder', data: { key: operation.data.id, type: 'folder' } };
        } else if (operation.op === 'update') {
          action = {
            action: 'updateObject',
            data: { key: operation.data.id, type: 'object', content: operation.data.attributes.content },
          };
        } else if (operation.op === 'remove') {
          action = { action: 'removeObject', key: operation.ref.id };
        }
        if (action) {
          const denied = await authorizeAction(action);
          if (denied) return denied;
        }
      }

      type Written = { value: StorageObject | Folder, recoverableErrors: ReadonlyArray<ContentiaError> };
      const write = (operation: Exclude<AtomicOperation, { op: 'remove' }>): Promise<ContentiaResult<Written>> => {
        if (!operation.data.id) {
          return Promise.resolve(Result.fail(new InvalidData('data.id is required and must be a non-empty key')));
        }
        if (operation.op === 'add') {
          const { data } = operation;
          if (data.type === 'folder') {
            return runTaskWithMetadata<StorageObject | Folder>(repo.createFolder({ key: data.id, type: 'folder' }));
          }
          return runTaskWithMetadata<StorageObject | Folder>(repo.createObject({
            key: data.id,
            type: 'object',
            content: data.attributes.content || {},
          }));
        }
        return runTaskWithMetadata<StorageObject | Folder>(repo.updateObject({
          key: operation.data.id,
          type: 'object',
          content: operation.data.attributes.content,
        }));
      };

      const operations = body['atomic:operations'];
      // Adds and updates start now and run concurrently.
      const pendingWrites = operations.map(operation => operation.op === 'remove' ? undefined : write(operation));

      // Removes run one key at a time, in request order (see removeOne). A
      // call that fails outright fails the request; later removes are skipped.
      const removals = new Map<number, { removed: boolean, recoverableErrors: ReadonlyArray<ContentiaError> }>();
      for (const [index, operation] of operations.entries()) {
        if (operation.op !== 'remove') continue;
        const result = await removeOne(operation.ref.id);
        if (Result.isFailure(result)) return failResponse(result, mappedStatus(result.failure));
        removals.set(index, result.success);
      }

      const writes = await Promise.all(pendingWrites);

      type AtomicResultEntry =
        | { data: JsonApiResource, meta?: { warnings: JsonApiError['errors'] } }
        | { meta: { deleted: true, ref: { type: 'atom', id: string }, warnings?: JsonApiError['errors'] } }
        | { errors: JsonApiError['errors'] };
      const atomicResults: AtomicResultEntry[] = [];
      operations.forEach((operation, index) => {
        if (operation.op === 'remove') {
          const removal = removals.get(index)!;
          const warnings = recoverableErrorsToWarnings(removal.recoverableErrors);
          if (removal.removed) {
            // Per the JSON:API atomic extension, a successful remove has no
            // `data` (the resource is gone); `meta` says what was deleted.
            atomicResults.push({
              meta: { deleted: true, ref: { type: 'atom', id: operation.ref.id }, ...(warnings ? { warnings } : {}) },
            });
          } else {
            // Unlike a failed add or update, a failed remove keeps its slot:
            // the proxy's `removeAtoms` walks `atomic:results` index-aligned
            // with its keys to count removed and skipped. Its errors are the
            // ones the repository reported for this key.
            atomicResults.push({
              errors: warnings
                ?? errorToJsonApiMapper(new NotFoundError(`Nothing was removed at "${operation.ref.id}"`), logger)
                  .errors,
            });
          }
          return;
        }
        const written = writes[index];
        if (!written || Result.isFailure(written)) return;
        const { value, recoverableErrors } = written.success;
        const data = value.type === 'object' ? storageObjectToJsonApi(value) : folderToJsonApi(value);
        const warnings = recoverableErrorsToWarnings(recoverableErrors);
        atomicResults.push(warnings ? { data, meta: { warnings } } : { data });
      });

      return json({ 'atomic:results': atomicResults } as unknown as JsonApiResponse);
    } else {
      options.logger?.debug('storage endpoint not found:', path);
      return failResponse(
        Result.fail(new NotFoundError('Storage endpoint not found')),
        404,
      );
    }
  }
}
