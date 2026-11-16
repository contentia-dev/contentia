import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiSchema,
} from 'contentia/json-api';
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

import { STORAGE_API_VERSION } from './jsonapi.js';

/** Page size the handler lists with when the request carries no `page[*]` key. */
const DEFAULT_PAGE_SIZE = 100;

const jsonApiResponse = (description: string, schemaName: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref(schemaName)),
});

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
const errorResponse = (description: string): OpenApiResponse => jsonApiResponse(description, 'JsonApiError');

// Repository failures are translated to HTTP statuses via ErrorCodeToStatusMap
// (not_found → 404, bad_request/invalid_data → 400, internal → 500, …), so the
// exact status of a failed repo call depends on the backend's error code.
const mappedRepositoryError = errorResponse(
  'Repository failure. The status code is mapped from the underlying error code '
    + '(e.g. not_found → 404, bad_request → 400, internal → 500).',
);

const forbiddenResponse = errorResponse('The access policy denied this action.');

const keyPathParameter = (description: string): OpenApiParameter => ({
  name: 'key',
  in: 'path',
  required: true,
  description: `${description} The key is one path segment, so each slash in it is percent-encoded as \`%2F\` `
    + '(`posts/hello-world` → `posts%2Fhello-world`). A URL with more path segments after the key is rejected '
    + 'with 400 `invalid_data`.',
  schema: { type: 'string' },
});

const UNENCODED_SLASH = 'the URL has path segments after the key (a slash in the key not percent-encoded as `%2F`)';

/** The 400 for a keyed route whose only request-level failure is an unencoded slash in the key. */
const extraSegmentsResponse = errorResponse(`Invalid key: ${UNENCODED_SLASH}.`);

const listQueryParameters: OpenApiParameter[] = [
  ...paginationParameters({ defaultPageSize: DEFAULT_PAGE_SIZE }),
  {
    name: 'filter[depth]',
    in: 'query',
    description: 'Recursion depth for the folder walk. Values that are not integers >= 1 fall back to 1.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  },
];

const jsonApiRequestBody = (description: string, schemaName: string): OpenApiRequestBody => ({
  description,
  required: true,
  content: jsonApiContent(ref(schemaName)),
});

const listAtomsOperation = (operationId: string, summary: string, keyed: boolean): OpenApiOperation => ({
  operationId,
  summary,
  tags: ['atoms'],
  parameters: listQueryParameters,
  responses: {
    '200': jsonApiResponse(
      'Atoms in the folder, with pagination links and optional meta.page.total / meta.warnings.',
      'AtomCollectionResponse',
    ),
    '400': errorResponse(
      'Cursor pagination (page[after] / page[before]) requested but unsupported by the backend, or '
        + (keyed ? `${UNENCODED_SLASH}.` : 'filter[prefix] sent (put the folder key in the path instead).'),
    ),
    '403': forbiddenResponse,
    ...(keyed ? { '404': errorResponse('Folder not found.') } : {}),
    default: mappedRepositoryError,
  },
});

const listAtomSummariesOperation = (operationId: string, summary: string, keyed: boolean): OpenApiOperation => {
  const base = listAtomsOperation(operationId, summary, keyed);
  return {
    ...base,
    responses: {
      ...base.responses,
      '200': jsonApiResponse(
        'Atom summaries in the folder, with pagination links and optional meta.page.total / meta.warnings.',
        'AtomSummaryCollectionResponse',
      ),
    },
  };
};

/** A resource whose attributes are nothing but timestamps. */
const timestampedResource = (typeName: string, idDescription: string): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: typeName },
    id: { type: 'string', description: idDescription },
    attributes: {
      type: 'object',
      properties: {
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
      },
    },
    links: ref('ResourceLinks'),
  },
});

/** A JSON:API request document wrapping one data member. */
const dataRequest = (dataSchemaName: string): OpenApiSchema => ({
  type: 'object',
  required: ['data'],
  properties: { data: ref(dataSchemaName) },
});

/**
 * The write payload for a storage object. Create and update accept the same
 * shape; only the meaning of `id` differs, which the caller documents.
 */
const storageObjectWriteData = (idDescription: string, contentDescription?: string): OpenApiSchema => ({
  type: 'object',
  required: ['type', 'id', 'attributes'],
  properties: {
    type: { const: 'object' },
    id: { type: 'string', description: idDescription },
    attributes: {
      type: 'object',
      description: 'Only "type" and "content" are accepted; any other key is rejected with 400.',
      properties: {
        type: { const: 'object' },
        content: {
          type: 'object',
          additionalProperties: true,
          ...(contentDescription ? { description: contentDescription } : {}),
        },
      },
      additionalProperties: false,
    },
    meta: ref('StorageObjectMetadata'),
  },
});

const schemas: Record<string, OpenApiSchema> = {
  ...jsonApiErrorComponents(),
  ...jsonApiLinkComponents(),
  ...capabilityComponents({ changeSubscription: true }),
  ...apiInfoComponents('storage'),

  StorageObjectMetadata: {
    type: 'object',
    description: 'Capability-driven object metadata (file extension, backend revision id, backend-specific extras).',
    properties: {
      extension: { type: 'string' },
      revisionId: { type: 'string' },
    },
    additionalProperties: true,
  },
  StorageObjectAttributes: {
    type: 'object',
    required: ['content'],
    properties: {
      content: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
  StorageObjectResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'object' },
      id: { type: 'string', description: 'The storage key.' },
      attributes: ref('StorageObjectAttributes'),
      meta: ref('StorageObjectMetadata'),
      links: ref('ResourceLinks'),
    },
  },
  FolderAttributes: {
    type: 'object',
    properties: {
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
  FolderResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'folder' },
      id: { type: 'string', description: 'The folder key.' },
      attributes: ref('FolderAttributes'),
      links: ref('ResourceLinks'),
    },
  },
  StorageObjectSummaryResource: timestampedResource('object-summary', 'The storage key.'),
  FolderSummaryResource: timestampedResource('folder-summary', 'The folder key.'),
  AtomResource: {
    oneOf: [ref('StorageObjectResource'), ref('FolderResource')],
  },
  AtomSummaryResource: {
    oneOf: [ref('StorageObjectSummaryResource'), ref('FolderSummaryResource')],
  },
  Capabilities: {
    type: 'object',
    required: ['compatibilityDate', 'fileExtensions', 'pagination', 'changes'],
    properties: {
      compatibilityDate: {
        type: 'string',
        format: 'date',
        description: 'The repository contract version the backend implements, as YYYY-MM-DD. It changes when the '
          + 'repository contract changes, so a client can compare it to detect an incompatible backend.',
      },
      changes: ref('ChangesCapability'),
      fileExtensions: {
        oneOf: [
          ref('UnsupportedCapability'),
          {
            type: 'object',
            required: ['supported', 'description', 'supportedExtensions'],
            properties: {
              supported: { const: true },
              description: { type: 'string' },
              supportedExtensions: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  required: ['format'],
                  properties: { format: { type: 'string' } },
                },
              },
            },
          },
        ],
      },
      pagination: ref('PaginationCapability'),
    },
  },
  CapabilitiesResource: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'storage-capabilities' },
      id: { const: 'self' },
      attributes: ref('Capabilities'),
      links: ref('ResourceLinks'),
    },
  },
  CapabilitiesResponse: {
    type: 'object',
    required: ['data'],
    properties: { data: ref('CapabilitiesResource') },
  },
  StorageObjectResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('StorageObjectResource'),
      meta: ref('WarningsMeta'),
    },
  },
  FolderResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('FolderResource'),
      meta: ref('WarningsMeta'),
    },
  },
  AtomResponse: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('AtomResource'),
      meta: ref('WarningsMeta'),
    },
  },
  AtomCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('AtomResource') },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  AtomSummaryCollectionResponse: {
    type: 'object',
    required: ['data', 'links'],
    properties: {
      data: { type: 'array', items: ref('AtomSummaryResource') },
      links: ref('PaginationLinks'),
      meta: ref('CollectionMeta'),
    },
  },
  ObjectDeletedResponse: {
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
  StorageObjectCreateData: storageObjectWriteData(
    'The storage key. Must be non-empty.',
    'The object content. Defaults to `{}` when omitted.',
  ),
  StorageObjectUpdateData: storageObjectWriteData('The storage key. Must match the key in the URL.'),
  FolderCreateData: {
    type: 'object',
    required: ['type', 'id', 'attributes'],
    properties: {
      type: { const: 'folder' },
      id: { type: 'string', description: 'The folder key. Must be non-empty.' },
      attributes: {
        type: 'object',
        description: 'Keys other than "type" are ignored.',
        properties: { type: { const: 'folder' } },
      },
    },
  },
  StorageObjectCreateRequest: dataRequest('StorageObjectCreateData'),
  StorageObjectUpdateRequest: dataRequest('StorageObjectUpdateData'),
  FolderCreateRequest: dataRequest('FolderCreateData'),
  AtomRef: {
    type: 'object',
    required: ['type', 'id'],
    properties: {
      type: { enum: ['object', 'folder', 'atom'] },
      id: { type: 'string' },
    },
  },
  AtomicAddOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'add' },
      data: { oneOf: [ref('StorageObjectCreateData'), ref('FolderCreateData')] },
    },
  },
  AtomicUpdateOperation: {
    type: 'object',
    required: ['op', 'data'],
    properties: {
      op: { const: 'update' },
      data: ref('StorageObjectUpdateData'),
    },
  },
  AtomicRemoveOperation: {
    type: 'object',
    required: ['op', 'ref'],
    properties: {
      op: { const: 'remove' },
      ref: ref('AtomRef'),
    },
  },
  AtomicOperationsRequest: {
    type: 'object',
    required: ['atomic:operations'],
    properties: {
      'atomic:operations': {
        type: 'array',
        items: {
          oneOf: [ref('AtomicAddOperation'), ref('AtomicUpdateOperation'), ref('AtomicRemoveOperation')],
        },
      },
    },
  },
  AtomicChangeResult: {
    type: 'object',
    required: ['data'],
    properties: {
      data: ref('AtomResource'),
      meta: ref('WarningsMeta'),
    },
  },
  AtomicRemoveResult: {
    type: 'object',
    required: ['meta'],
    properties: {
      meta: {
        type: 'object',
        required: ['deleted', 'ref'],
        properties: {
          deleted: { const: true },
          ref: {
            type: 'object',
            description: "The removed key. `type` is always `atom`, whatever type the operation's ref named.",
            required: ['type', 'id'],
            properties: {
              type: { const: 'atom' },
              id: { type: 'string' },
            },
          },
          warnings: ref('Warnings'),
        },
      },
    },
  },
  AtomicErrorResult: {
    type: 'object',
    required: ['errors'],
    properties: {
      errors: { type: 'array', items: ref('JsonApiErrorObject') },
    },
  },
  AtomicResultsResponse: {
    type: 'object',
    description: 'Results in request order. A successful add or update yields `data`, and a successful remove '
      + 'yields `meta.deleted`, plus any warnings the repository reported for that key. A remove fails when the '
      + 'repository removes nothing at its key; a failed remove keeps its slot as an `errors` entry holding the '
      + 'errors the repository reported for that key. A failed add or update is omitted, so a request containing '
      + 'only removes gets exactly one result per operation.',
    required: ['atomic:results'],
    properties: {
      'atomic:results': {
        type: 'array',
        items: { oneOf: [ref('AtomicChangeResult'), ref('AtomicRemoveResult'), ref('AtomicErrorResult')] },
      },
    },
  },
};

const paths: Record<string, OpenApiPathItem> = {
  '/': {
    get: {
      operationId: 'getApiInfo',
      summary: 'API info and endpoint discovery',
      tags: ['info'],
      responses: {
        '200': jsonApiResponse('API info resource listing the available endpoints.', 'ApiInfoResponse'),
      },
    },
  },
  '/openapi.json': {
    get: {
      operationId: 'getOpenApiDocument',
      summary: 'This OpenAPI 3.1 document',
      tags: ['info'],
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 document describing this API, with servers rewritten to the request '
            + "origin plus the handler's basePath.",
          content: {
            'application/json': {
              schema: { type: 'object', description: 'An OpenAPI 3.1 document.' },
            },
          },
        },
        '403': forbiddenResponse,
      },
    },
  },
  '/openapi.yaml': {
    get: {
      operationId: 'getOpenApiDocumentYaml',
      summary: 'This OpenAPI 3.1 document, as YAML',
      tags: ['info'],
      responses: {
        '200': {
          description: 'The OpenAPI 3.1 document describing this API as YAML, with servers rewritten to the request '
            + "origin plus the handler's basePath.",
          content: {
            'application/yaml': {
              schema: { type: 'object', description: 'An OpenAPI 3.1 document.' },
            },
          },
        },
        '403': forbiddenResponse,
      },
    },
  },
  '/capabilities': {
    get: {
      operationId: 'getCapabilities',
      summary: 'Underlying storage repository capabilities',
      description: 'Resolved from the repository on every request, so a swapped-out backend is reflected immediately.',
      tags: ['capabilities'],
      responses: {
        '200': jsonApiResponse('The storage-capabilities resource.', 'CapabilitiesResponse'),
        '403': forbiddenResponse,
        default: mappedRepositoryError,
      },
    },
  },
  '/atoms': {
    get: listAtomsOperation('listRootAtoms', 'List atoms in the root folder', false),
    post: {
      operationId: 'createFolder',
      summary: 'Create a folder',
      tags: ['atoms', 'folders'],
      requestBody: jsonApiRequestBody('JSON:API folder resource to create.', 'FolderCreateRequest'),
      responses: {
        '201': jsonApiResponse('The created folder resource.', 'FolderResponse'),
        '400': errorResponse('Invalid request body, or data.id is empty.'),
        '403': forbiddenResponse,
        default: mappedRepositoryError,
      },
    },
  },
  '/atoms/{key}': {
    parameters: [keyPathParameter('Key of the folder to list.')],
    get: listAtomsOperation('listAtoms', 'List atoms in a folder', true),
  },
  '/atom/{key}': {
    parameters: [keyPathParameter('Key of the object or folder.')],
    get: {
      operationId: 'getAtom',
      summary: 'Read an atom (object or folder)',
      tags: ['atoms'],
      responses: {
        '200': jsonApiResponse(
          'The object or folder at the key, possibly with meta.warnings.',
          'AtomResponse',
        ),
        '400': extraSegmentsResponse,
        '403': forbiddenResponse,
        '404': errorResponse('Neither an object nor a folder exists at the key.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/atom-summaries': {
    get: listAtomSummariesOperation(
      'listRootAtomSummaries',
      'List atom summaries (lightweight listing) in the root folder',
      false,
    ),
  },
  '/atom-summaries/{key}': {
    parameters: [keyPathParameter('Key of the folder to list.')],
    get: listAtomSummariesOperation('listAtomSummaries', 'List atom summaries (lightweight listing) in a folder', true),
  },
  '/objects': {
    post: {
      operationId: 'createStorageObject',
      summary: 'Create a storage object',
      tags: ['objects'],
      requestBody: jsonApiRequestBody('JSON:API storage object resource to create.', 'StorageObjectCreateRequest'),
      responses: {
        '201': jsonApiResponse('The created storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '400': errorResponse('Invalid request body, unknown attribute key, or empty data.id.'),
        '403': forbiddenResponse,
        '409': errorResponse('An object already exists at the requested key.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/objects/{key}': {
    description: 'Methods other than GET, PATCH and DELETE, POST included, are answered with 405 Method Not '
      + 'Allowed and the header `Allow: GET, PATCH, DELETE`. Create an object with POST /objects.',
    parameters: [keyPathParameter('Key of the storage object.')],
    get: {
      operationId: 'getStorageObject',
      summary: 'Read a storage object',
      tags: ['objects'],
      responses: {
        '200': jsonApiResponse('The storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '400': extraSegmentsResponse,
        '403': forbiddenResponse,
        '404': errorResponse('Object not found.'),
        default: mappedRepositoryError,
      },
    },
    patch: {
      operationId: 'updateStorageObject',
      summary: 'Update a storage object',
      tags: ['objects'],
      requestBody: jsonApiRequestBody(
        'JSON:API storage object resource; data.id must match the key in the URL.',
        'StorageObjectUpdateRequest',
      ),
      responses: {
        '200': jsonApiResponse('The updated storage object, possibly with meta.warnings.', 'StorageObjectResponse'),
        '400': errorResponse(
          'Invalid request body, unknown attribute key, URL key does not match body data.id, or '
            + `${UNENCODED_SLASH}.`,
        ),
        '403': forbiddenResponse,
        '404': errorResponse('Object not found.'),
        default: mappedRepositoryError,
      },
    },
    delete: {
      operationId: 'deleteStorageObject',
      summary: 'Delete a storage object',
      tags: ['objects'],
      responses: {
        '200': jsonApiResponse('Deletion confirmation, possibly with meta.warnings.', 'ObjectDeletedResponse'),
        '400': extraSegmentsResponse,
        '403': forbiddenResponse,
        '404': errorResponse('Object not found (nothing was removed).'),
        default: mappedRepositoryError,
      },
    },
  },
  '/folders/{key}': {
    parameters: [keyPathParameter('Key of the folder.')],
    get: {
      operationId: 'getFolder',
      summary: 'Read a folder',
      tags: ['folders'],
      responses: {
        '200': jsonApiResponse('The folder resource, possibly with meta.warnings.', 'FolderResponse'),
        '400': extraSegmentsResponse,
        '403': forbiddenResponse,
        '404': errorResponse('Folder not found.'),
        default: mappedRepositoryError,
      },
    },
  },
  '/operations': {
    post: {
      operationId: 'runAtomicOperations',
      summary: 'Atomic operations (add, update, remove)',
      description: 'JSON:API atomic operations extension. Every operation is authorized before any runs, and one '
        + 'denial rejects the whole request. Adds and updates then run concurrently, while removes run one key per '
        + 'repository call, in request order; results keep request order. A failed add or update is omitted from '
        + 'atomic:results, and a failed remove keeps its slot as an `errors` entry. The operations are not '
        + 'transactional: when a remove call fails outright, the request fails and later removes are not '
        + 'attempted, while adds, updates and earlier removes may already have been applied.',
      tags: ['operations'],
      requestBody: jsonApiRequestBody('Atomic operations to apply.', 'AtomicOperationsRequest'),
      responses: {
        '200': jsonApiResponse(
          'One result per successful operation and per failed remove, in request order.',
          'AtomicResultsResponse',
        ),
        '400': errorResponse(
          'Invalid atomic operations request, or an unknown attribute key in an object add or update.',
        ),
        '403': forbiddenResponse,
        default: errorResponse(
          'A remove call failed outright. The status code is mapped from the underlying error code '
            + '(e.g. not_found → 404, bad_request → 400, internal → 500).',
        ),
      },
    },
  },
};

export interface StorageOpenApiOptions {
  basePath?: string | undefined;
}

/**
 * Build the OpenAPI 3.1 document describing the storage JSON:API handler
 * produced by `buildJsonApi`. Path keys are relative to `basePath`,
 * which only feeds the `servers` entry (the served /openapi.json and
 * /openapi.yaml routes rewrite it to the request origin plus `basePath`).
 */
export function buildStorageOpenApi(options: StorageOpenApiOptions = {}): OpenApiDocument {
  const { basePath = '' } = options;
  return compactOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Contentia Storage API',
      version: STORAGE_API_VERSION,
      description: 'JSON:API-style HTTP interface over a Contentia StorageRepository: storage objects, folders, '
        + 'atom listings, capabilities introspection, and JSON:API atomic operations. Successful responses may carry '
        + 'a meta.warnings array of non-fatal recoverable errors alongside the requested data. '
        + '⚠️ The handler ships no authentication — wrap it before exposing it to an untrusted network.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: basePath || '/' }],
    tags: [
      { name: 'info', description: 'API metadata and discovery' },
      { name: 'capabilities', description: 'Backend capability introspection' },
      { name: 'atoms', description: 'Folder listings over objects and folders (atoms)' },
      { name: 'objects', description: 'Storage object CRUD' },
      { name: 'folders', description: 'Folder resources' },
      { name: 'operations', description: 'JSON:API atomic operations extension' },
    ],
    paths,
    components: {
      schemas,
      responses: jsonApiErrorResponseComponents(),
    },
  });
}
