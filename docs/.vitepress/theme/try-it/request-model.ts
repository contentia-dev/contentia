/**
 * The request window's model, apart from its component so it can be tested: what an operation
 * takes, read from the API's OpenAPI spec, and the request a filled-in window sends.
 */
import type { HttpExample } from '../../../reference/examples/http-example';

type Schema = Readonly<Record<string, unknown>>;

export interface Spec {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly servers?: readonly { readonly url: string }[];
}

export type ParamLocation = 'path' | 'query' | 'header';

export interface Param {
  readonly name: string;
  readonly in: ParamLocation;
  readonly required: boolean;
  readonly description: string;
  readonly schema: Schema;
  /** What the window starts with: the operation's example value, else the spec's, else empty. */
  readonly initial: string;
}

export interface BodyType {
  readonly mediaType: string;
  readonly schema: Schema;
}

export interface TryOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly server: string;
  readonly params: readonly Param[];
  /** The request body's media types, in the spec's order. Empty when the operation takes none. */
  readonly bodyTypes: readonly BodyType[];
  /** The JSON body the window starts with: the operation's example, else one sampled from the schema. */
  readonly initialBody: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const LOCATIONS: readonly string[] = ['path', 'query', 'header'];

const isObject = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Follow `$ref`s to `#/…` until a value that isn't one. Unresolvable refs become `{}`. */
export function deref(spec: object, value: unknown): Schema {
  const seen = new Set<string>();
  let current = value;
  while (isObject(current) && typeof current.$ref === 'string') {
    const ref = current.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    seen.add(ref);
    current = ref
      .slice(2)
      .split('/')
      .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((node, part) => (isObject(node) ? node[part] : undefined), spec);
  }
  return isObject(current) ? current : {};
}

const MAX_DEPTH = 8;

/**
 * A value that fits `schema`, for a body the window starts with when the operation has no
 * example. Takes the schema's own example, default, const, or first enum value where it has one;
 * objects get their required properties, or every property when none is required.
 */
export function sample(spec: object, schema: unknown, depth = 0): unknown {
  const s = deref(spec, schema);
  if ('example' in s) return s.example;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if ('default' in s) return s.default;
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (depth > MAX_DEPTH) return null;
  const variants = s.oneOf ?? s.anyOf;
  if (Array.isArray(variants) && variants.length) return sample(spec, variants[0], depth + 1);
  if (Array.isArray(s.allOf)) {
    return Object.assign({}, ...s.allOf.map(part => sample(spec, part, depth + 1)).filter(isObject));
  }
  const types = Array.isArray(s.type) ? s.type : [s.type];
  const type = types.find(t => t !== 'null') ?? (s.properties ? 'object' : s.items ? 'array' : undefined);
  switch (type) {
    case 'object': {
      const properties = isObject(s.properties) ? s.properties : {};
      const required = Array.isArray(s.required) ? s.required : [];
      const names = required.length ? required.filter(name => name in properties) : Object.keys(properties);
      return Object.fromEntries(names.map(name => [name, sample(spec, properties[name], depth + 1)]));
    }
    case 'array':
      return s.items ? [sample(spec, s.items, depth + 1)] : [];
    case 'string':
      return s.format === 'date-time' ? new Date(0).toISOString() : '';
    case 'integer':
    case 'number':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

const text = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/** The operation `operationId` names in `spec`, as the request window shows it. */
export function findOperation(spec: Spec, operationId: string): TryOperation | undefined {
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = deref(spec, item[method]);
      if (operation.operationId !== operationId) continue;
      const example = (operation['x-example'] ?? {}) as HttpExample;
      const declared = [
        ...(Array.isArray(item.parameters) ? item.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ].map(param => deref(spec, param));
      const params = declared
        .filter(param => typeof param.name === 'string' && LOCATIONS.includes(param.in as string))
        .map((param): Param => {
          const name = param.name as string;
          const location = param.in as ParamLocation;
          const schema = deref(spec, param.schema);
          const given = location === 'header' ? undefined : example[location]?.[name];
          return {
            name,
            in: location,
            required: location === 'path' || param.required === true,
            description: text(param.description),
            schema,
            initial: text(given ?? param.example ?? schema.example),
          };
        });
      const content = deref(spec, operation.requestBody).content;
      const bodyTypes = Object.entries(isObject(content) ? content : {}).map(([mediaType, media]) => ({
        mediaType,
        schema: deref(spec, deref(spec, media).schema),
      }));
      const jsonType = bodyTypes.find(type => isJson(type.mediaType));
      const body = example.body ?? (jsonType ? sample(spec, jsonType.schema) : undefined);
      return {
        operationId,
        method,
        path,
        summary: text(operation.summary) || operationId,
        server: spec.servers?.[0]?.url ?? '',
        params,
        bodyTypes,
        initialBody: body === undefined ? '' : JSON.stringify(body, null, 2),
      };
    }
  }
  return undefined;
}

export const isJson = (mediaType: string) => /[/+]json\b/i.test(mediaType);

/** A query parameter name as people write it: `filter[depth]`, not `filter%5Bdepth%5D`. */
const encodeQueryPart = (part: string) => encodeURIComponent(part).replace(/%5B/gi, '[').replace(/%5D/gi, ']');

/**
 * The URL a request goes to. Path parameters are percent-encoded (`posts/hello` becomes
 * `posts%2Fhello`); an empty one stays a `{name}` placeholder. Empty query parameters are left out.
 */
export function buildUrl(operation: TryOperation, values: Readonly<Record<string, string>>): string {
  const path = operation.path.replace(/\{([^}]+)\}/g, (placeholder, name: string) => {
    const value = values[`path:${name}`];
    return value ? encodeURIComponent(value) : placeholder;
  });
  const query = operation.params
    .filter(param => param.in === 'query' && values[`query:${param.name}`])
    .map(param => `${encodeQueryPart(param.name)}=${encodeQueryPart(values[`query:${param.name}`]!)}`)
    .join('&');
  return `${operation.server}${path}${query ? `?${query}` : ''}`;
}

export interface CurlRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly (readonly [name: string, value: string])[];
  /** A JSON body, as text. */
  readonly body?: string;
  /** A multipart body's fields; a file field's value is its file name. */
  readonly form?: readonly (readonly [name: string, value: string, file: boolean])[];
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The request as a cURL command, one flag per line. */
export function toCurl(request: CurlRequest): string {
  const method = request.method.toUpperCase();
  const implied = method === 'GET' || (method === 'POST' && (request.body || request.form?.length));
  const lines = [`curl${implied ? '' : ` -X ${method}`} ${shellQuote(request.url)}`];
  for (const [name, value] of request.headers) lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  for (const [name, value, file] of request.form ?? []) {
    lines.push(`-F ${shellQuote(`${name}=${file ? '@' : ''}${value}`)}`);
  }
  if (request.body) lines.push(`-d ${shellQuote(request.body)}`);
  return lines.join(' \\\n  ');
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A spec description as HTML: escaped, with its `code` spans as `<code>`, the only Markdown it uses. */
export const inlineCode = (text: string) => escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** `json` as HTML, its keys, strings, numbers and literals wrapped in classed spans. */
export function highlightJson(json: string): string {
  let html = '';
  let last = 0;
  for (const match of json.matchAll(JSON_TOKEN)) {
    const [token, string, colon, literal] = match;
    html += escapeHtml(json.slice(last, match.index));
    const kind = string ? (colon ? 'key' : 'string') : literal ? 'literal' : 'number';
    html += `<span class="tok-${kind}">${escapeHtml(string ?? token)}</span>${colon ? escapeHtml(colon) : ''}`;
    last = match.index + token.length;
  }
  return html + escapeHtml(json.slice(last));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Reason phrases, since a `Response` built in the browser has an empty `statusText`. */
export const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  412: 'Precondition Failed',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  500: 'Internal Server Error',
  501: 'Not Implemented',
};
