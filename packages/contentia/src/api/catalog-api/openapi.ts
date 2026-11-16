import type { OpenApiDocument, OpenApiResponse, OpenApiSchema } from 'contentia/json-api';
import {
  compactOpenApiDocument,
  jsonApiContent,
  jsonApiErrorComponents,
  jsonApiErrorResponseComponents,
  schemaRef as ref,
} from 'contentia/json-api';

export interface CatalogOpenApiOptions {
  basePath?: string;
}

// The handler sets this header on every response it writes, errors included.
const noStoreHeaders: NonNullable<OpenApiResponse['headers']> = {
  'Cache-Control': {
    description: 'Always `no-store`.',
    schema: { type: 'string', const: 'no-store' },
  },
};

// Authored inline so every operation keeps its own wording; the document is run
// through `compactOpenApiDocument` on the way out, which folds each occurrence
// into a `$ref` against the `ErrorResponse` component.
const errorResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('JsonApiError')),
  headers: noStoreHeaders,
});

const forbiddenResponse = errorResponse('The access policy denied this action.');

// A failure the settings provider returns is mapped through its own status, and
// a provider may fail with any ContentiaError, so the set is open-ended.
const providerErrorResponse = errorResponse(
  'The settings provider failed; the response carries the status of its error (e.g. 500 for an internal '
    + 'error), which may also be a status listed separately.',
);

const writeBadRequestResponse = errorResponse('Malformed body or invalid JSON:API schema.');

const unreachableResponse = errorResponse('Downstream service (e.g. DynamoDB) unreachable.');

const collectionResponse = (description: string): OpenApiResponse => ({
  description,
  content: jsonApiContent(ref('CollectionDocument')),
  headers: noStoreHeaders,
});

// The shared `ErrorResponse` plus this handler's `Cache-Control` header, so the
// inline error responses above still fold into it rather than into a twin.
const responseComponents: Record<string, OpenApiResponse> = Object.fromEntries(
  Object.entries(jsonApiErrorResponseComponents())
    .map(([name, response]) => [name, { ...response, headers: noStoreHeaders }]),
);

const schemas: Record<string, OpenApiSchema> = {
  // This handler never attaches meta.warnings to a successful response.
  ...jsonApiErrorComponents({ warnings: false }),

  UnpublishedStatusConfig: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Directory where documents with this status are stored.' },
      name: { type: 'string', description: 'Human-readable name for this status.' },
    },
    required: ['directory', 'name'],
  },
  DocumentCollectionAttributes: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable label.' },
      directory: { type: 'string', description: 'Storage root directory for this collection.' },
      recursive: { type: 'boolean', description: 'Include sub-directories in listings.' },
      format: { type: 'string', description: 'Default file format (e.g. "markdown").' },
      documentTitleKey: { type: 'string', description: 'Frontmatter key used as the document title.' },
      documentDescriptionKey: { type: 'string', description: 'Frontmatter key used as the document description.' },
      documentStatusKey: { type: 'string', description: 'Frontmatter key used as the document status.' },
      unpublishedStatuses: {
        type: 'object',
        description: 'Map of unpublished status values to their configuration.',
        additionalProperties: ref('UnpublishedStatusConfig'),
      },
      revisionDirectory: { type: 'string', description: 'Directory for revision snapshots.' },
      draftDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.draft.directory (name defaults to "Draft"). Explicit unpublishedStatuses.draft wins if both are provided.',
      },
      archiveDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.archived.directory (name defaults to "Archived"). Explicit unpublishedStatuses.archived wins if both are provided.',
      },
      trashDirectory: {
        type: 'string',
        description:
          'Shorthand for unpublishedStatuses.trash.directory (name defaults to "Trash"). Explicit unpublishedStatuses.trash wins if both are provided.',
      },
    },
  },
  MediaCollectionAttributes: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable label.' },
      directory: { type: 'string', description: 'Storage root directory for this collection.' },
      recursive: { type: 'boolean', description: 'Include sub-directories in listings.' },
      accept: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files the collection accepts, as in the HTML `accept` attribute: MIME types (`image/png`), '
          + 'wildcards (`image/*`), or file extensions (`.png`). Empty or left out accepts any file.',
      },
      url: { type: 'string', description: 'Public URL prefix for served media files.' },
      pathFormat: { type: 'string', description: 'Template for generating media file paths.' },
    },
  },
  DocumentCollectionResource: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        const: 'document-collection',
        description: 'Resource type; selects a document collection.',
      },
      id: { type: 'string', description: 'Collection key.' },
      attributes: ref('DocumentCollectionAttributes'),
    },
    required: ['type', 'id', 'attributes'],
  },
  MediaCollectionResource: {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'media-collection', description: 'Resource type; selects a media collection.' },
      id: { type: 'string', description: 'Collection key.' },
      attributes: ref('MediaCollectionAttributes'),
    },
    required: ['type', 'id', 'attributes'],
  },
  CollectionResource: {
    oneOf: [
      ref('DocumentCollectionResource'),
      ref('MediaCollectionResource'),
    ],
  },
  CollectionDocument: {
    type: 'object',
    properties: {
      data: ref('CollectionResource'),
    },
    required: ['data'],
  },
  CollectionListDocument: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: ref('CollectionResource'),
      },
    },
    required: ['data'],
  },
};

export function buildCatalogOpenApi(options: CatalogOpenApiOptions = {}): OpenApiDocument {
  const { basePath = '' } = options;

  return compactOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Contentia Catalog API',
      version: '1.0.1',
      license: { name: 'MIT', identifier: 'MIT' },
      description: 'JSON:API-style server for catalog collection settings (document and media collections). '
        + 'All responses carry Cache-Control: no-store. '
        + 'The handler requires an access policy (`authorize`) and runs it before every operation; a denial '
        + 'answers 403 unless the policy returns its own error. The handler authenticates no one itself: '
        + 'validate credentials inside the policy, or mount the handler behind a layer that does.',
    },
    servers: [{ url: basePath === '' ? '/' : basePath }],
    tags: [
      { name: 'collections', description: 'Catalog collection settings.' },
      { name: 'openapi', description: 'API metadata.' },
    ],
    paths: {
      '/openapi.json': {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Get the OpenAPI 3.1 document describing this API',
          tags: ['openapi'],
          responses: {
            '200': {
              description: 'The OpenAPI document, with `servers` set to the request origin plus the mount path.',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
              headers: noStoreHeaders,
            },
            '403': forbiddenResponse,
          },
        },
      },
      '/openapi.yaml': {
        get: {
          operationId: 'getOpenApiDocumentYaml',
          summary: 'Get the OpenAPI 3.1 document describing this API, as YAML',
          tags: ['openapi'],
          responses: {
            '200': {
              description:
                'The OpenAPI document as YAML, with `servers` set to the request origin plus the mount path.',
              content: {
                'application/yaml': {
                  schema: { type: 'object' },
                },
              },
              headers: noStoreHeaders,
            },
            '403': forbiddenResponse,
          },
        },
      },
      '/collections': {
        get: {
          operationId: 'listCollections',
          summary: 'List all collections',
          tags: ['collections'],
          responses: {
            '200': {
              description: 'All configured collections.',
              content: jsonApiContent(ref('CollectionListDocument')),
              headers: noStoreHeaders,
            },
            '403': forbiddenResponse,
            '503': unreachableResponse,
            default: providerErrorResponse,
          },
        },
        post: {
          operationId: 'createCollection',
          summary: 'Create a collection',
          description: 'Writes the collection under `data.id`, replacing any existing collection with that key.',
          tags: ['collections'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('CollectionDocument')),
          },
          responses: {
            '201': collectionResponse(
              'The submitted collection as decoded, echoed back; it is not read back from the settings provider.',
            ),
            '400': writeBadRequestResponse,
            '403': forbiddenResponse,
            '503': unreachableResponse,
            default: providerErrorResponse,
          },
        },
      },
      '/collections/{key}': {
        parameters: [
          {
            name: 'key',
            in: 'path',
            required: true,
            description: 'Collection key (JSON:API resource id).',
            schema: { type: 'string' },
          },
        ],
        get: {
          operationId: 'getCollection',
          summary: 'Read a single collection',
          tags: ['collections'],
          responses: {
            '200': collectionResponse('The requested collection.'),
            '400': errorResponse('The stored collection has an unknown type.'),
            '403': forbiddenResponse,
            '404': errorResponse('Collection key does not exist.'),
            '503': unreachableResponse,
            default: providerErrorResponse,
          },
        },
        patch: {
          operationId: 'updateCollection',
          summary: 'Update a collection',
          description: "The submitted attributes replace the collection's settings; they are not merged with the "
            + 'stored ones.',
          tags: ['collections'],
          requestBody: {
            required: true,
            content: jsonApiContent(ref('CollectionDocument')),
          },
          responses: {
            '200': collectionResponse(
              'The submitted collection as decoded, echoed back; it is not read back from the settings provider.',
            ),
            '400': writeBadRequestResponse,
            '403': forbiddenResponse,
            '404': errorResponse('Collection key does not exist.'),
            '409': errorResponse('Body data.id does not match the URL key.'),
            '503': unreachableResponse,
            default: providerErrorResponse,
          },
        },
        delete: {
          operationId: 'deleteCollection',
          summary: 'Delete a collection',
          tags: ['collections'],
          responses: {
            '204': { description: 'Collection deleted. Empty body.', headers: noStoreHeaders },
            '403': forbiddenResponse,
            '404': errorResponse('Collection key does not exist.'),
            '503': unreachableResponse,
            default: providerErrorResponse,
          },
        },
      },
    },
    components: { schemas, responses: responseComponents },
  });
}
