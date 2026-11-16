import type { OpenApiDocument, OpenApiParameter, OpenApiResponse, OpenApiSchema } from 'contentia/json-api';
import {
  apiInfoComponents,
  capabilityComponents,
  compactOpenApiDocument,
  jsonApiContent,
  jsonApiErrorComponents,
  jsonApiErrorResponseComponents,
  jsonApiLinkComponents,
  paginationParameters,
  schemaRef as ref,
} from 'contentia/json-api';

/** `parsePaginationQuery` falls back to page 1 × 10 items for this API. */
const DEFAULT_PAGE_SIZE = 10;

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('JsonApiError')),
});

const forbiddenResponse = errorResponse('The access policy denied this action.');

const keyParameter: OpenApiParameter = {
  name: 'key',
  in: 'path',
  required: true,
  description: 'Document key (URL-encoded; keys may contain `/`, encoded as `%2F`).',
  schema: { type: 'string', maxLength: 1023 },
};

const revisionIdParameter: OpenApiParameter = {
  name: 'revisionId',
  in: 'path',
  required: true,
  description: 'Revision identifier (URL-encoded).',
  schema: { type: 'string' },
};

const recordsFilterParameters: OpenApiParameter[] = [
  {
    name: 'filter[type]',
    in: 'query',
    description: 'Which record variants to list. `all` lists both published and unpublished. Defaults to `published`.',
    schema: { type: 'string', enum: ['published', 'unpublished', 'all'] },
  },
  {
    name: 'filter[folder]',
    in: 'query',
    description: 'Folder to list: a collection name, or a path inside one such as `posts/drafts`. Empty or '
      + 'omitted lists the root, which depends on the backend: the catalog backend returns one `folder` item per '
      + 'document collection; the drizzle and obsidian backends return the records under the root, to `filter[depth]`.',
    schema: { type: 'string' },
  },
  {
    name: 'filter[depth]',
    in: 'query',
    description: 'Folder recursion depth. Defaults to 1.',
    schema: { type: 'integer', minimum: 1 },
  },
];

const listParameters = [...recordsFilterParameters, ...paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE })];

/**
 * Attributes for one resource variant: the timestamps and language every
 * record carries, composed with the variant's own fields. The resource type
 * lives on the envelope only; it is never repeated inside `attributes`.
 */
const resourceAttributes = (
  extra: Record<string, OpenApiSchema>,
  required: string[],
): OpenApiSchema => ({
  allOf: [
    ref('RecordTimestamps'),
    { type: 'object', required, properties: extra },
  ],
});

const resource = (
  typeName: string,
  attributes: OpenApiSchema,
  idDescription = 'Document key.',
): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: idDescription },
    attributes,
    links: ref('ResourceLinks'),
  },
});

/** A folder entry in a records listing. Folders have no detail route, so no `links`. */
const folderResource = (typeName: string): OpenApiSchema => ({
  type: 'object',
  description: "A folder in a records listing, such as the catalog backend's one-per-collection root entries.",
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: 'Folder key.' },
    attributes: {
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
});

const contentWriteProperty: OpenApiSchema = ref('DocumentContent');

/** The optional `version` a published or unpublished record (full or summary) carries. Revisions have none. */
const versionProperty: OpenApiSchema = {
  type: 'string',
  description: 'Opaque per-record version token; it changes if and only if the record changed. Compare only by '
    + 'equality. Present only when the backend tracks versions (GET /capabilities, `versionTracking`).',
};

const languageCreateProperty: OpenApiSchema = {
  type: 'string',
  description: 'BCP 47 language tag. Defaults to `und` (undetermined) when omitted on create.',
};

const unpublishedStatusProperty: OpenApiSchema = {
  type: 'string',
  minLength: 1,
  description: 'Unpublished state, e.g. `draft`, `pending_review`, `archived`, `trash`. The catalog backend '
    + 'accepts only the statuses configured for the collection.',
};

/**
 * The `{type, id, attributes}` payload a write carries. Shared by the
 * single-resource request bodies and by the equivalent batch operations, which
 * accept exactly the same data member. `attributes` stays open: the decoder
 * accepts any member and passes it on to the repository.
 */
const writeData = (
  typeName: string,
  attributes: { description: string, properties: Record<string, OpenApiSchema>, required?: string[] },
): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: 'Document key.' },
    attributes: {
      type: 'object',
      description: attributes.description,
      ...(attributes.required ? { required: attributes.required } : {}),
      properties: attributes.properties,
      additionalProperties: true,
    },
  },
});

/** A JSON:API request document wrapping one write payload. */
const writeRequest = (dataSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: { data: ref(dataSchemaName) },
});

/** A JSON:API response document wrapping one resource, plus warnings meta. */
const resourceResponse = (resourceSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: {
    data: ref(resourceSchemaName),
    meta: ref('WarningsMeta'),
  },
});

/** A paginated collection of `items`, with links and collection meta. */
const collectionResponse = (items: OpenApiSchema): OpenApiSchema => ({
  type: 'object',
  required: ['data', 'links'],
  properties: {
    data: { type: 'array', items },
    links: ref('PaginationLinks'),
    meta: ref('CollectionMeta'),
  },
});

const schemas: Record<string, OpenApiSchema> = {
  ...jsonApiErrorComponents(),
  ...jsonApiLinkComponents(),
  ...capabilityComponents({ versionTracking: true }),
  ...apiInfoComponents('documents'),

  ChangesMeta: {
    allOf: [
      ref('CollectionMeta'),
      {
        type: 'object',
        properties: {
          syncToken: {
            type: 'string',
            description: 'On change-feed responses: the new sync token to resume from.',
          },
        },
      },
    ],
  },
  RecordTimestamps: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'BCP 47 language tag; `und` when undetermined.',
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  DocumentContent: {
    type: 'object',
    description: 'Arbitrary document content.',
    additionalProperties: true,
  },
  SyncTokenResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'sync-token' },
      id: { type: 'string', description: 'The folder scope, or "self" for the whole store.' },
      attributes: {
        type: 'object',
        required: ['syncToken'],
        properties: {
          syncToken: {
            type: 'string',
            description: 'Opaque per-scope change token; compare only by equality.',
          },
          folder: { type: 'string', description: 'Folder scope, when the token was scoped.' },
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  SyncTokenResponse: resourceResponse('SyncTokenResource'),
  ChangeSummaryResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'change-summary' },
      id: { type: 'string', description: 'The key that changed. Each key appears once, with its latest state.' },
      attributes: {
        type: 'object',
        required: ['deleted'],
        properties: {
          deleted: { type: 'boolean', description: 'True when the record was removed from the scope.' },
          version: {
            type: 'string',
            description: 'Opaque per-record version token after the change. Omitted for deletions and on backends '
              + 'without version tracking.',
          },
        },
      },
    },
  },
  ChangesCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('ChangeSummaryResource') },
      links: {
        type: 'object',
        description: 'The feed is not paginated, so `self` is the only link.',
        required: ['self'],
        properties: { self: { type: 'string' } },
      },
      meta: ref('ChangesMeta'),
    },
  },
  PublishedResource: resource(
    'published',
    resourceAttributes({
      status: { const: 'published' },
      content: ref('DocumentContent'),
      version: versionProperty,
    }, ['status', 'content']),
  ),
  PublishedSummaryResource: resource(
    'published-summary',
    resourceAttributes({
      status: { const: 'published' },
      version: versionProperty,
    }, ['status']),
  ),
  UnpublishedResource: resource(
    'unpublished',
    resourceAttributes({
      status: {
        type: 'string',
        description: 'Unpublished state, e.g. `draft`, `pending_review`, `archived`, `trash`.',
      },
      content: ref('DocumentContent'),
      version: versionProperty,
    }, ['status', 'content']),
  ),
  UnpublishedSummaryResource: resource(
    'unpublished-summary',
    resourceAttributes({
      status: { type: 'string' },
      version: versionProperty,
    }, ['status']),
  ),
  RevisionResource: resource(
    'revision',
    resourceAttributes({
      key: { type: 'string', description: 'Document key.' },
      revision: { type: 'string' },
      content: ref('DocumentContent'),
    }, ['key', 'revision', 'content', 'createdAt']),
    'Composite `{key}/{revision}`: the document key and the revision identifier joined by `/`.',
  ),
  RevisionSummaryResource: resource(
    'revision-summary',
    resourceAttributes({
      key: { type: 'string', description: 'Document key.' },
      revision: { type: 'string' },
    }, ['key', 'revision']),
    'Composite `{key}/{revision}`: the document key and the revision identifier joined by `/`.',
  ),
  FolderResource: folderResource('folder'),
  FolderSummaryResource: folderResource('folder-summary'),
  CapabilitiesResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'documents-capabilities' },
      id: { const: 'self' },
      attributes: {
        type: 'object',
        required: ['compatibilityDate', 'pagination', 'versionTracking', 'changes'],
        properties: {
          compatibilityDate: {
            type: 'string',
            format: 'date',
            description: 'The repository contract version the backend implements, as YYYY-MM-DD. It changes when '
              + 'the repository contract changes, so a client can compare it to detect an incompatible backend.',
          },
          pagination: ref('PaginationCapability'),
          versionTracking: ref('VersionTrackingCapability'),
          changes: ref('ChangesCapability'),
        },
      },
      links: ref('ResourceLinks'),
    },
  },
  CapabilitiesResponse: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('CapabilitiesResource') },
  },
  PublishedResponse: resourceResponse('PublishedResource'),
  UnpublishedResponse: resourceResponse('UnpublishedResource'),
  RevisionResponse: resourceResponse('RevisionResource'),
  RecordsCollectionResponse: collectionResponse({
    oneOf: [ref('PublishedResource'), ref('UnpublishedResource'), ref('FolderResource')],
  }),
  RecordSummariesCollectionResponse: collectionResponse({
    oneOf: [ref('PublishedSummaryResource'), ref('UnpublishedSummaryResource'), ref('FolderSummaryResource')],
  }),
  RevisionSummariesCollectionResponse: collectionResponse(ref('RevisionSummaryResource')),
  DeletedResponse: {
    type: 'object',
    required: ['meta'],
    properties: {
      meta: {
        type: 'object',
        required: ['deleted'],
        properties: {
          deleted: { const: true },
          warnings: ref('Warnings'),
        },
      },
    },
  },
  PublishedWriteData: writeData('published', {
    description: 'Document attributes. On update, attributes left out keep their value.',
    properties: {
      status: { const: 'published' },
      language: languageCreateProperty,
      content: contentWriteProperty,
    },
  }),
  UnpublishedCreateData: writeData('unpublished', {
    description: 'Draft attributes.',
    required: ['status'],
    properties: {
      status: unpublishedStatusProperty,
      language: languageCreateProperty,
      content: contentWriteProperty,
    },
  }),
  UnpublishedUpdateData: writeData('unpublished', {
    description: 'Draft attributes to change; attributes left out keep their value.',
    properties: {
      status: unpublishedStatusProperty,
      language: { type: 'string', description: 'BCP 47 language tag.' },
      content: contentWriteProperty,
    },
  }),
  RevisionWriteData: writeData('revision', {
    description: 'Revision attributes. `data.id` is the document key the revision belongs to.',
    required: ['revision'],
    properties: {
      revision: {
        type: 'string',
        minLength: 1,
        description: 'Revision identifier, unique per document (e.g. `v1`).',
      },
      language: languageCreateProperty,
      content: contentWriteProperty,
    },
  }),
  PublishedCreateRequest: writeRequest('PublishedWriteData'),
  UnpublishedCreateRequest: writeRequest('UnpublishedCreateData'),
  UnpublishedUpdateRequest: writeRequest('UnpublishedUpdateData'),
  RevisionCreateRequest: writeRequest('RevisionWriteData'),
  UnpublishTarget: {
    type: 'object',
    required: ['type', 'attributes'],
    properties: {
      type: { const: 'unpublished' },
      attributes: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', description: 'Unpublished state to transition the document into.' },
        },
      },
    },
  },
  UnpublishRequest: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('UnpublishTarget') },
  },
  ResourceRef: {
    type: 'object',
    required: ['id', 'type'],
    properties: {
      id: { type: 'string', description: 'Document key.' },
      type: {
        type: 'string',
        enum: ['document', 'unpublished'],
        description: '`document` names the published document, `unpublished` the draft.',
      },
    },
  },
  AddPublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: ref('PublishedWriteData'),
    },
  },
  AddUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: ref('UnpublishedCreateData'),
    },
  },
  StateTransitionOperation: {
    type: 'object',
    required: ['op', 'href', 'ref'],
    properties: {
      op: { const: 'update' },
      href: {
        type: 'string',
        enum: ['/publish', '/unpublish'],
        description: '`/publish` requires ref.type `unpublished`; `/unpublish` requires ref.type `document` '
          + 'plus a `data` member carrying the target status.',
      },
      ref: ref('ResourceRef'),
      data: ref('UnpublishTarget'),
    },
  },
  UpdateUnpublishedOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'update' },
      data: ref('UnpublishedUpdateData'),
    },
  },
  RemoveOperation: {
    type: 'object',
    required: ['op', 'ref'],
    properties: {
      op: { const: 'remove' },
      ref: ref('ResourceRef'),
    },
  },
  BatchOperationsRequest: {
    type: 'object',
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        items: {
          oneOf: [
            ref('AddPublishedOperation'),
            ref('AddUnpublishedOperation'),
            ref('StateTransitionOperation'),
            ref('UpdateUnpublishedOperation'),
            ref('RemoveOperation'),
          ],
        },
      },
    },
  },
  AtomicResultError: {
    type: 'object',
    description: 'The repository failure that stopped the batch.',
    required: ['status', 'code', 'title', 'detail'],
    properties: {
      status: { type: 'string', description: 'HTTP status of the failure, as a string.' },
      code: {
        type: 'string',
        description: 'Machine-readable Contentia error code, e.g. `entry_already_exists`, `not_found`.',
      },
      title: { const: 'Operation Failed' },
      detail: { type: 'string', description: 'The failure message.' },
    },
  },
  AtomicResult: {
    oneOf: [
      {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            oneOf: [ref('PublishedResource'), ref('UnpublishedResource'), { type: 'null' }],
          },
          meta: ref('WarningsMeta'),
        },
      },
      {
        type: 'object',
        required: ['meta'],
        properties: {
          meta: {
            type: 'object',
            required: ['deleted', 'ref'],
            properties: {
              deleted: { const: true },
              ref: ref('ResourceRef'),
              warnings: ref('Warnings'),
            },
          },
        },
      },
      {
        type: 'object',
        required: ['errors'],
        properties: {
          errors: { type: 'array', items: ref('AtomicResultError') },
        },
      },
    ],
  },
  BatchOperationsResponse: {
    type: 'object',
    required: ['results'],
    properties: {
      results: {
        type: 'array',
        description: 'One entry per operation run, in request order. The first repository failure stops the '
          + 'batch: its operation gets an `errors` entry and later operations get none. Operations before it '
          + 'stay applied.',
        items: ref('AtomicResult'),
      },
    },
  },
};

/**
 * Build the OpenAPI 3.1 document describing {@link buildJsonApi}'s routes.
 * `basePath` must match the one the server was built with; path keys are
 * relative to it. The server route `GET {basePath}/openapi.json` serves this
 * document with `servers[0].url` rewritten to the request origin.
 */
export function buildDocumentsOpenApi(options: { basePath?: string } = {}): OpenApiDocument {
  const { basePath = '' } = options;

  return compactOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Contentia Documents API',
      version: '1.0.1',
      license: { name: 'MIT', identifier: 'MIT' },
      description: 'JSON:API-style HTTP interface over a Contentia documents repository: published documents, '
        + 'unpublished drafts, revisions, publish/unpublish state transitions, and fail-fast operation batches. '
        + 'Success responses use the `application/vnd.api+json` media type. '
        + 'Warning: this API ships no built-in authentication — wrap it with middleware that validates '
        + 'credentials before exposing it to an untrusted network, otherwise anyone who can reach it can read, '
        + 'create, modify, publish, unpublish, and delete documents and revisions.',
    },
    servers: [{ url: basePath === '' ? '/' : basePath }],
    tags: [
      { name: 'info', description: 'API self-description.' },
      { name: 'capabilities', description: 'Backend capability introspection.' },
      { name: 'changes', description: 'Capability-gated change signals (sync tokens + change feed).' },
      { name: 'records', description: 'Combined published + unpublished listings.' },
      { name: 'published', description: 'Published documents.' },
      { name: 'unpublished', description: 'Unpublished drafts.' },
      { name: 'revisions', description: 'Document revisions.' },
      { name: 'operations', description: 'Fail-fast batch operations.' },
    ],
    paths: {
      '/': {
        get: {
          operationId: 'getApiInfo',
          summary: 'List available endpoints',
          tags: ['info'],
          responses: {
            '200': {
              description: 'API info resource enumerating the available endpoints.',
              content: jsonApiContent(ref('ApiInfoResponse')),
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get this OpenAPI 3.1 document',
          tags: ['info'],
          responses: {
            '200': {
              description: 'The OpenAPI document, with `servers[0].url` resolved against the request origin.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '403': forbiddenResponse,
          },
        },
      },
      '/openapi.yaml': {
        get: {
          operationId: 'getOpenApiDocumentYaml',
          summary: 'Get this OpenAPI 3.1 document, as YAML',
          tags: ['info'],
          responses: {
            '200': {
              description: 'The OpenAPI document as YAML, with `servers[0].url` resolved against the request origin.',
              content: { 'application/yaml': { schema: { type: 'object' } } },
            },
            '403': forbiddenResponse,
          },
        },
      },
      '/capabilities': {
        get: {
          operationId: 'getCapabilities',
          summary: 'Get the underlying documents repository capabilities',
          tags: ['capabilities'],
          responses: {
            '200': {
              description: 'Capabilities of the backing documents repository.',
              content: jsonApiContent(ref('CapabilitiesResponse')),
            },
            '400': errorResponse('Repository failure mapped from its error code.'),
            '403': forbiddenResponse,
            '404': errorResponse('Capabilities unavailable.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/sync-token': {
        get: {
          operationId: 'getSyncToken',
          summary: 'Get an opaque change token for a scope',
          description: 'Returns a token that changes whenever anything inside the scope (a folder, or the whole '
            + 'store when filter[folder] is omitted) changes. Compare tokens only by equality. Capability-gated: '
            + 'backends without change-signal support answer 501 (consult GET /capabilities, `changes`).',
          tags: ['changes'],
          parameters: [
            {
              name: 'filter[folder]',
              in: 'query',
              description: 'Scope the token to a folder. Omit for the whole store. Pass the same folder to '
                + 'GET /changes when using the token.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'The current sync token for the scope.',
              content: jsonApiContent(ref('SyncTokenResponse')),
            },
            '400': errorResponse('Repository failure mapped from its error code.'),
            '403': forbiddenResponse,
            '501': errorResponse('The backing repository does not support sync tokens.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/changes': {
        get: {
          operationId: 'listChanges',
          summary: 'List changes since a sync token',
          description: 'Lists what changed inside the scope since a previously obtained sync token: one '
            + '`change-summary` per changed key, carrying its latest state, not one per change event. The feed is '
            + 'not paginated. `meta.syncToken` carries the new token to resume from. Capability-gated: backends '
            + 'without a change feed answer 501 (consult GET /capabilities, `changes`).',
          tags: ['changes'],
          parameters: [
            {
              name: 'filter[since]',
              in: 'query',
              required: true,
              description: 'A sync token previously obtained from GET /sync-token or a prior GET /changes.',
              schema: { type: 'string' },
            },
            {
              name: 'filter[folder]',
              in: 'query',
              description: 'Scope the feed to a folder. Must be the folder the `filter[since]` token was obtained '
                + 'for; omit both for the whole store.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Change summary collection; `meta.syncToken` carries the new token.',
              content: jsonApiContent(ref('ChangesCollectionResponse')),
            },
            '400': errorResponse('Missing filter[since], an unrecognized sync token, or a bad-request failure.'),
            '403': forbiddenResponse,
            '501': errorResponse('The backing repository does not support a change feed.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/records': {
        get: {
          operationId: 'listRecords',
          summary: 'List full records (published and/or unpublished view per key)',
          tags: ['records'],
          parameters: listParameters,
          responses: {
            '200': {
              description: 'Record collection with pagination links, `meta.page.total` when the backend reports '
                + 'a total, and `meta.warnings` for per-item recoverable errors.',
              content: jsonApiContent(ref('RecordsCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid filter/pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '403': forbiddenResponse,
            '404': errorResponse('Repository reported not-found (e.g. unknown collection).'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/record-summaries': {
        get: {
          operationId: 'listRecordSummaries',
          summary: 'List record summaries (lightweight listing without content)',
          tags: ['records'],
          parameters: listParameters,
          responses: {
            '200': {
              description: 'Record summary collection with pagination links and meta.',
              content: jsonApiContent(ref('RecordSummariesCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid filter/pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '403': forbiddenResponse,
            '404': errorResponse('Repository reported not-found (e.g. unknown collection).'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/published': {
        post: {
          operationId: 'createPublished',
          summary: 'Create a published document',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('PublishedCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created published document; `meta.warnings` carries recoverable write warnings.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, missing `data.id`, or repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Repository reported not-found.'),
            '409': errorResponse('A document already exists at the requested key.'),
          },
        },
      },
      '/published/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'getPublished',
          summary: 'Read a published document',
          tags: ['published'],
          responses: {
            '200': {
              description: 'The published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Document not found.'),
          },
        },
        patch: {
          operationId: 'updatePublished',
          summary: 'Update a published document',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('PublishedCreateRequest')),
          },
          responses: {
            '200': {
              description: 'The updated published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, missing `data.id`, or repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Document not found.'),
            '409': errorResponse("The body's `data.id` does not match the `key` in the URL."),
          },
        },
        delete: {
          operationId: 'deletePublished',
          summary: 'Remove a published document',
          tags: ['published'],
          responses: {
            '200': {
              description: 'Deletion confirmation; `meta.warnings` carries recoverable cleanup warnings.',
              content: jsonApiContent(ref('DeletedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Document not found.'),
          },
        },
      },
      '/published/{key}/unpublish': {
        parameters: [keyParameter],
        post: {
          operationId: 'unpublishPublished',
          summary: 'State transition: move a published document to unpublished',
          tags: ['published'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishRequest')),
          },
          responses: {
            '200': {
              description: 'The resulting unpublished document.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Published document not found.'),
          },
        },
      },
      '/unpublished': {
        post: {
          operationId: 'createUnpublished',
          summary: 'Create an unpublished draft',
          tags: ['unpublished'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishedCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse(
              'Malformed JSON, schema-invalid body, missing `data.id` or `data.attributes.status`, or repository '
                + 'failure (e.g. a status the backend does not accept).',
            ),
            '403': forbiddenResponse,
            '404': errorResponse('Repository reported not-found.'),
            '409': errorResponse('A draft already exists at the requested key.'),
          },
        },
      },
      '/unpublished/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'getUnpublished',
          summary: 'Read an unpublished draft',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'The unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Draft not found.'),
          },
        },
        patch: {
          operationId: 'updateUnpublished',
          summary: 'Update an unpublished draft',
          tags: ['unpublished'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('UnpublishedUpdateRequest')),
          },
          responses: {
            '200': {
              description: 'The updated unpublished draft.',
              content: jsonApiContent(ref('UnpublishedResponse')),
            },
            '400': errorResponse('Malformed JSON, schema-invalid body, or repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Draft not found.'),
            '409': errorResponse("The body's `data.id` does not match the `key` in the URL."),
          },
        },
        delete: {
          operationId: 'deleteUnpublished',
          summary: 'Delete an unpublished draft',
          description: 'Deletes the draft permanently; it is not moved to trash.',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'Deletion confirmation; `meta.warnings` carries recoverable cleanup warnings.',
              content: jsonApiContent(ref('DeletedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Draft not found.'),
          },
        },
      },
      '/unpublished/{key}/publish': {
        parameters: [keyParameter],
        post: {
          operationId: 'publishUnpublished',
          summary: 'State transition: publish an unpublished draft',
          tags: ['unpublished'],
          responses: {
            '200': {
              description: 'The resulting published document.',
              content: jsonApiContent(ref('PublishedResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Draft not found.'),
          },
        },
      },
      '/revisions': {
        post: {
          operationId: 'createRevision',
          summary: 'Create a revision for a document',
          tags: ['revisions'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('RevisionCreateRequest')),
          },
          responses: {
            '201': {
              description: 'Created revision.',
              content: jsonApiContent(ref('RevisionResponse')),
            },
            '400': errorResponse(
              'Malformed JSON, schema-invalid body, missing `data.id` or `data.attributes.revision`, or repository '
                + 'failure.',
            ),
            '403': forbiddenResponse,
            '404': errorResponse('Repository reported not-found.'),
            '409': errorResponse('A revision already exists at the requested key.'),
          },
        },
      },
      '/revisions/{key}': {
        parameters: [keyParameter],
        get: {
          operationId: 'listRevisions',
          summary: 'List revisions for a document',
          tags: ['revisions'],
          parameters: paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE }),
          responses: {
            '200': {
              description: 'Revision summary collection with pagination links and meta.',
              content: jsonApiContent(ref('RevisionSummariesCollectionResponse')),
            },
            '400': errorResponse(
              'Invalid pagination parameters, cursor pagination requested but unsupported by the backend, '
                + 'or a bad-request repository failure.',
            ),
            '403': forbiddenResponse,
            '404': errorResponse('Document not found.'),
            '500': errorResponse('Internal repository failure.'),
          },
        },
      },
      '/revisions/{key}/{revisionId}': {
        parameters: [keyParameter, revisionIdParameter],
        get: {
          operationId: 'getRevision',
          summary: 'Read a specific revision of a document',
          tags: ['revisions'],
          responses: {
            '200': {
              description: 'The revision.',
              content: jsonApiContent(ref('RevisionResponse')),
            },
            '400': errorResponse('Repository failure.'),
            '403': forbiddenResponse,
            '404': errorResponse('Revision not found.'),
          },
        },
      },
      '/operations': {
        post: {
          operationId: 'postBatchOperations',
          summary: 'Batch operations (add/update/remove and publish/unpublish transitions)',
          description: 'Fail-fast batch. Every operation is checked for request shape before any I/O: a '
            + 'shape-invalid op (e.g. an `add` without `data.id`, or an unpublished `add` without '
            + '`data.attributes.status`) returns 400 with zero writes. Every operation is then authorized before '
            + 'any write: one denial fails the whole batch with 403 and nothing is written. Ops then run in order, '
            + 'and the first repository failure stops processing; ops applied before it stay applied. This is a '
            + 'fail-fast batch, not a transaction.',
          tags: ['operations'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('BatchOperationsRequest')),
          },
          responses: {
            '200': {
              description: 'Results for all applied operations. Processing stopped if a repository failure occurred.',
              content: jsonApiContent(ref('BatchOperationsResponse')),
            },
            '400': errorResponse(
              'Malformed JSON, schema-invalid body, or a shape-invalid operation; nothing is written.',
            ),
            '403': forbiddenResponse,
          },
        },
      },
    },
    components: {
      schemas,
      responses: jsonApiErrorResponseComponents(),
    },
  });
}
