import { describe, expect, it } from 'vitest';

import { buildUrl, deref, findOperation, highlightJson, inlineCode, sample, type Spec, toCurl } from './request-model';

const spec = {
  servers: [{ url: 'https://cms.example.com/documents' }],
  components: {
    parameters: {
      Key: { name: 'key', in: 'path', required: true, schema: { type: 'string' } },
      FilterType: { name: 'filter[type]', in: 'query', schema: { type: 'string', enum: ['published', 'all'] } },
    },
    schemas: {
      Create: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['type', 'id'],
            properties: {
              type: { const: 'published' },
              id: { type: 'string' },
              meta: { type: 'object' },
            },
          },
        },
      },
      Loop: { $ref: '#/components/schemas/Loop' },
    },
  },
  paths: {
    '/records': {
      get: { operationId: 'listRecords', parameters: [{ $ref: '#/components/parameters/FilterType' }] },
    },
    '/published': {
      post: {
        operationId: 'createPublished',
        summary: 'Create a published document',
        requestBody: { content: { 'application/vnd.api+json': { schema: { $ref: '#/components/schemas/Create' } } } },
      },
    },
    '/published/{key}': {
      parameters: [{ $ref: '#/components/parameters/Key' }],
      get: { operationId: 'getPublished', 'x-example': { path: { key: 'posts/hello-world' } } },
    },
  },
} as Spec;

describe('deref', () => {
  it('follows a chain of local refs', () => {
    expect(deref(spec, { $ref: '#/components/parameters/Key' })).toMatchObject({ name: 'key' });
  });

  it('gives up on missing and circular refs', () => {
    expect(deref(spec, { $ref: '#/components/schemas/Missing' })).toEqual({});
    expect(deref(spec, { $ref: '#/components/schemas/Loop' })).toEqual({});
  });
});

describe('sample', () => {
  it('fills in required properties only, preferring const and enum values', () => {
    expect(sample(spec, { $ref: '#/components/schemas/Create' })).toEqual({ data: { type: 'published', id: '' } });
  });

  it("prefers the schema's own example", () => {
    expect(sample(spec, { type: 'string', example: 'posts/hello' })).toBe('posts/hello');
  });

  it('takes the first variant of a oneOf', () => {
    expect(sample(spec, { oneOf: [{ type: 'integer', minimum: 1 }, { type: 'string' }] })).toBe(1);
  });
});

describe('findOperation', () => {
  it('resolves parameters, path-level ones included, and starts from the example', () => {
    const operation = findOperation(spec, 'getPublished')!;
    expect(operation).toMatchObject({ method: 'get', path: '/published/{key}', server: spec.servers![0]!.url });
    expect(operation.params).toEqual([
      expect.objectContaining({ name: 'key', in: 'path', required: true, initial: 'posts/hello-world' }),
    ]);
  });

  it('samples a JSON body when the operation has no example', () => {
    const operation = findOperation(spec, 'createPublished')!;
    expect(operation.summary).toBe('Create a published document');
    expect(operation.bodyTypes.map(type => type.mediaType)).toEqual(['application/vnd.api+json']);
    expect(JSON.parse(operation.initialBody)).toEqual({ data: { type: 'published', id: '' } });
  });

  it('is undefined for an unknown operation', () => {
    expect(findOperation(spec, 'nope')).toBeUndefined();
  });
});

describe('buildUrl', () => {
  it('percent-encodes path parameters and keeps an empty one as its placeholder', () => {
    const operation = findOperation(spec, 'getPublished')!;
    expect(buildUrl(operation, { 'path:key': 'posts/a b' })).toBe(
      'https://cms.example.com/documents/published/posts%2Fa%20b',
    );
    expect(buildUrl(operation, {})).toBe('https://cms.example.com/documents/published/{key}');
  });

  it('leaves out empty query parameters and keeps brackets readable', () => {
    const operation = findOperation(spec, 'listRecords')!;
    expect(buildUrl(operation, { 'query:filter[type]': '' })).toBe('https://cms.example.com/documents/records');
    expect(buildUrl(operation, { 'query:filter[type]': 'all' })).toBe(
      'https://cms.example.com/documents/records?filter[type]=all',
    );
  });
});

describe('toCurl', () => {
  it('leaves out the method curl infers, and quotes for the shell', () => {
    expect(toCurl({ method: 'post', url: 'https://x/y', headers: [['Accept', 'a/b']], body: `{"t":"it's"}` })).toBe(
      `curl 'https://x/y' \\\n  -H 'Accept: a/b' \\\n  -d '{"t":"it'\\''s"}'`,
    );
  });

  it('names any other method', () => {
    expect(toCurl({ method: 'delete', url: 'https://x/y', headers: [] })).toBe(`curl -X DELETE 'https://x/y'`);
  });

  it('sends a multipart body as form fields', () => {
    expect(toCurl({ method: 'post', url: 'https://x', headers: [], form: [['file', 'a.png', true]] })).toBe(
      `curl 'https://x' \\\n  -F 'file=@a.png'`,
    );
  });
});

describe('inlineCode', () => {
  it('turns code spans into <code> and escapes the rest', () => {
    expect(inlineCode('a `<b>` & `c`')).toBe('a <code>&lt;b&gt;</code> &amp; <code>c</code>');
  });
});

describe('highlightJson', () => {
  it('marks keys, strings, numbers and literals, and escapes HTML', () => {
    expect(highlightJson('{"a": "<b>", "n": -1.5, "ok": true}')).toBe(
      '{<span class="tok-key">"a"</span>: <span class="tok-string">"&lt;b&gt;"</span>, '
        + '<span class="tok-key">"n"</span>: <span class="tok-number">-1.5</span>, '
        + '<span class="tok-key">"ok"</span>: <span class="tok-literal">true</span>}',
    );
  });
});
