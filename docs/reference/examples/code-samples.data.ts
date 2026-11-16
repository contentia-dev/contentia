/**
 * Builds the HTTP API pages' data at build time: each API's OpenAPI spec, shaped for
 * `<OASpec>`, plus code samples for an API with hand-written examples. There, each operation gets
 * one code group: its Node.js example (the library call, from `<api>/<operation-id>.ts`) and a
 * cURL example (the JSON:API request, built from the spec plus the values in `<api>/http.ts`). The
 * groups are the same HTML VitePress renders for any other code group, so they're in the static
 * page and pick up the site's code styling; the reference page drops them into each operation's
 * `code-samples` slot.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { buildAssetsOpenApi } from 'contentia/assets-api';
import { buildCatalogOpenApi } from 'contentia/catalog-api';
import { buildDocumentsOpenApi } from 'contentia/documents-api';
import { buildStorageOpenApi } from 'contentia/storage-api';
import { createMarkdownRenderer, defineLoader, type MarkdownRenderer, type SiteConfig } from 'vitepress';

import type { HttpExample } from './http-example.js';
import { storageHttp } from './storage/http.js';

export interface ApiReference {
  /** The OpenAPI document `<OASpec>` renders. */
  readonly spec: object;
  /** The tags `<OASpec>` renders: every tag but {@link DISCOVERY_TAGS}. */
  readonly tags: readonly string[];
  /**
   * Rendered code-group HTML, keyed by operationId. Only an API with hand-written examples has
   * them; the others show vitepress-openapi's own samples, generated from the spec.
   */
  readonly samples?: Readonly<Record<string, string>>;
}

export interface Data {
  readonly storage: ApiReference;
  readonly documents: ApiReference;
  readonly assets: ApiReference;
  readonly catalog: ApiReference;
}

declare const data: Data;
export { data };

interface Operation {
  readonly operationId?: string;
  readonly tags?: readonly string[];
}

interface Spec {
  readonly paths: Record<string, Partial<Record<string, Operation>>>;
  readonly tags?: readonly { readonly name: string }[];
  readonly servers?: readonly { readonly url: string }[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** The server the examples talk to; the cURL tab of the reference's setup group exports it. */
const EXAMPLE_SERVER = 'https://cms.example.com';

/** `objects` → `Objects`: tag names are the reference's section headings. */
const capitalize = (tag: string) => tag.charAt(0).toUpperCase() + tag.slice(1);

/**
 * The (capitalized) tags of each API's discovery routes: `GET /openapi.json`, `GET /openapi.yaml`
 * and, on some, `GET /`. The reference leaves them out, since they describe the API rather than
 * the content it serves; each page mentions them instead. The APIs name this tag differently.
 */
const DISCOVERY_TAGS = new Set(['Info', 'Meta', 'Openapi']);

/**
 * The spec as the reference renders it: capitalized tag names, each operation under one tag only,
 * and an example server instead of the API's relative `/`, which vitepress-openapi can't resolve.
 * An operation under two tags (`POST /atoms` is under atoms and folders) would render twice, with
 * duplicate anchors and code groups whose tabs fight each other; it keeps its last, most specific
 * tag.
 */
function forDocs(spec: Spec, server: string): Spec {
  const withTags = (item: Partial<Record<string, Operation>>) =>
    Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        METHODS.includes(key) && value ? { ...value, tags: value.tags?.slice(-1).map(capitalize) } : value,
      ]),
    );
  return {
    ...spec,
    servers: [{ url: server }],
    tags: spec.tags?.map(tag => ({ ...tag, name: capitalize(tag.name) })),
    paths: Object.fromEntries(Object.entries(spec.paths).map(([path, item]) => [path, withTags(item)])),
  };
}

/** `getStorageObject` → `get-storage-object`, the example's file name. */
const kebab = (operationId: string) => operationId.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

/** The example as the reference shows it: everything but the import of the shared setup. */
const nodeExample = (file: string) =>
  readFileSync(file, 'utf8').replace(/^import .* from '\.\.\/setup\.js';\n\n?/m, '').trim();

function curlExample(method: string, path: string, example: HttpExample = {}): string {
  const url = path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(example.path?.[name] ?? `{${name}}`));
  // curl infers GET, and POST from -d; -G turns the --data-urlencode pairs into a query string.
  const flags = example.query
    ? ' -G'
    : method === 'get' || (method === 'post' && example.body)
    ? ''
    : ` -X ${method.toUpperCase()}`;
  const lines = [
    `curl${flags} "$CONTENTIA_URL${url}"`,
    '-H "Authorization: Bearer $CONTENTIA_TOKEN"',
    '-H "Accept: application/vnd.api+json"',
  ];
  for (const [name, value] of Object.entries(example.query ?? {})) lines.push(`--data-urlencode "${name}=${value}"`);
  if (example.body !== undefined) {
    lines.push('-H "Content-Type: application/vnd.api+json"');
    lines.push(`-d '${JSON.stringify(example.body, null, 2).replace(/\n/g, '\n  ')}'`);
  }
  return lines.join(' \\\n  ');
}

const codeGroup = (tabs: readonly (readonly [label: string, lang: string, code: string])[]) =>
  ['::: code-group', ...tabs.map(([label, lang, code]) => `\`\`\`${lang} [${label}]\n${code}\n\`\`\``), ':::'].join(
    '\n',
  );

function reference(api: string, spec: Spec): ApiReference {
  const docs = forDocs(spec, `${EXAMPLE_SERVER}/${api}`);
  const tags = (docs.tags ?? []).map(tag => tag.name).filter(name => !DISCOVERY_TAGS.has(name));
  return { spec: docs, tags };
}

function codeSamples(
  md: MarkdownRenderer,
  spec: Spec,
  http: Readonly<Record<string, HttpExample>>,
  files: readonly string[],
): Record<string, string> {
  const examples = new Map(files.map(file => [basename(file, '.ts'), file]));
  const samples: Record<string, string> = {};
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operationId = item[method]?.operationId;
      if (!operationId) continue;
      const node = examples.get(kebab(operationId));
      samples[operationId] = md.render(codeGroup([
        ...(node ? [['Node.js', 'ts', nodeExample(node)] as const] : []),
        ['cURL', 'sh', curlExample(method, path, http[operationId])],
      ]));
    }
  }
  return samples;
}

export default defineLoader({
  watch: ['./storage/*.ts'],
  async load(files): Promise<Data> {
    const config = (globalThis as { VITEPRESS_CONFIG?: SiteConfig }).VITEPRESS_CONFIG!;
    const md = await createMarkdownRenderer(config.srcDir, config.markdown, config.site.base, config.logger);
    const examplesOf = (api: string) => files.filter(file => basename(dirname(file)) === api);
    const storage = buildStorageOpenApi() as unknown as Spec;
    return {
      storage: {
        ...reference('storage', storage),
        samples: codeSamples(md, storage, storageHttp, examplesOf('storage')),
      },
      documents: reference('documents', buildDocumentsOpenApi() as unknown as Spec),
      assets: reference('assets', buildAssetsOpenApi() as unknown as Spec),
      catalog: reference('catalog', buildCatalogOpenApi() as unknown as Spec),
    };
  },
});
