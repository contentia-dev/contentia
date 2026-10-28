import * as path from 'node:path';

import type { StorageRepository, StorageSerializerRegistry } from 'contentia/storage';
import type { Plugin } from 'vite';

import { type ContentiaRepositories, createFsStorage, createRepositories, readItem } from './backend.js';
import { bodyOf, chunkPath, chunkSpecifier, pruneChunks, writeChunk } from './bodies.js';
import { createRepositoryChangeChannel } from './change-channel.js';
import { rewriteContentiaGlobs } from './glob.js';
import { type ContentiaLocalApiOptions, mountLocalApi } from './local-api.js';
import { renderModule } from './module.js';
import { isContentiaSource, isVirtualId, parseContentiaId, toVirtualId } from './protocol.js';
import type { ContentChangeChannel, ContentChangeEvent } from './typegen/channel.js';
import { type ContentiaTypegen, createTypegen } from './typegen/index.js';

export interface ContentiaTypegenPluginOptions {
  /** Append `as const` so literal types are preserved instead of widened to primitives. */
  literals?: boolean;
  /** Debounce window (ms) for coalescing incremental type writes. */
  debounceMs?: number;
}

export interface ContentiaVitePluginOptions {
  /**
   * Bring your own repositories. When omitted, a filesystem storage repository
   * (and Catalog documents and assets repositories derived from it) is
   * created from {@link ContentiaVitePluginOptions.dir}.
   */
  repositories?: ContentiaRepositories;
  /**
   * Provide only the storage repository; the documents and assets repositories
   * are derived from it via Catalog. Ignored when {@link repositories} is
   * given.
   */
  storage?: StorageRepository;
  /**
   * Directory the default filesystem repository reads, resolved relative to the
   * Vite project root. Ignored when {@link storage}/{@link repositories} is
   * given. Defaults to `'content'`.
   */
  dir?: string;
  /** File extension applied to keys without one. Defaults to `'json'`. */
  defaultExtension?: string;
  /** Serializer registry for the default filesystem repository. */
  serializers?: StorageSerializerRegistry;
  /**
   * Generate TypeScript declarations for `contentia:` imports (the TS compiler
   * infers them from the real content). `true` (default) or an options object;
   * `false` disables typegen.
   */
  typegen?: boolean | ContentiaTypegenPluginOptions;
  /**
   * Dev-server hot reload when content changes on disk. `true` (default) or
   * `{ coarse }` (invalidate every `contentia:` module on any change); `false`
   * disables it.
   */
  hmr?: boolean | { coarse?: boolean };
  /**
   * Write each item's `body` field out as an `.mdx` chunk under `.contentia/vite-generated/bodies/`
   * and re-export its default as `Body`, on top of the raw `body` string. This
   * plugin does not compile MDX — pair it with a plugin that does
   * (`@mdx-js/rollup`, ahead of your JSX plugin). Off by default.
   */
  mdx?: boolean;
  /**
   * Mount Contentia's own JSON:API over this plugin's repositories while the
   * Vite dev server is running ("local mode"), so a JSON:API client (e.g. the
   * Decap admin) reads and writes content locally instead of a remote
   * backend. `true` uses the default `/__contentia` base path; pass an object to
   * override it. Unauthenticated by design. Off by default — mounted only
   * from the dev-server hook, so a production build/preview never exposes it.
   */
  localApi?: boolean | ContentiaLocalApiOptions;
}

/**
 * Vite/Rolldown plugin that loads Contentia content as ES modules via the
 * `contentia:` protocol, generates matching TypeScript declarations, and hot-reloads
 * on content change. Content is inlined at build time, so it works in a fully
 * static, client-only build.
 */
export function contentia(options: ContentiaVitePluginOptions = {}): Plugin {
  let root = process.cwd();
  let isServe = false;
  let repos: ContentiaRepositories | undefined;
  let typegen: ContentiaTypegen | undefined;

  const getRepos = (): ContentiaRepositories => {
    if (repos) return repos;
    if (options.repositories) return (repos = options.repositories);
    const storage = options.storage ?? createFsStorage({
      dir: path.resolve(root, options.dir ?? 'content'),
      ...(options.defaultExtension ? { defaultExtension: options.defaultExtension } : {}),
      ...(options.serializers ? { serializers: options.serializers } : {}),
    });
    return (repos = createRepositories(storage));
  };

  const typegenEnabled = options.typegen !== false;
  const typegenOptions = typeof options.typegen === 'object' ? options.typegen : {};

  const hmrEnabled = options.hmr !== false;
  const hmrCoarse = typeof options.hmr === 'object' ? options.hmr.coarse ?? false : false;

  const mdxEnabled = options.mdx === true;
  /** Chunk paths written during this build, to prune the rest against. */
  const writtenChunks = new Set<string>();

  /** Bridge the repository's push channel to the typegen's change channel. */
  const makeContentChannel = (r: ContentiaRepositories): ContentChangeChannel => ({
    subscribe(listener) {
      try {
        return r.storage.subscribeChanges({}, changes => {
          for (const change of changes) {
            const event: ContentChangeEvent = {
              namespace: 'store',
              key: change.key,
              kind: change.deleted ? 'delete' : 'upsert',
            };
            listener(event);
          }
        });
      } catch {
        // Repository has no push channel (base throws NotImplementedError).
        return () => {};
      }
    },
  });

  const getTypegen = (): ContentiaTypegen | undefined => {
    if (!typegenEnabled) return undefined;
    if (typegen) return typegen;
    const r = getRepos();
    typegen = createTypegen({
      viteRoot: root,
      repos: r,
      mdx: mdxEnabled,
      ...(typegenOptions.literals !== undefined ? { literals: typegenOptions.literals } : {}),
      ...(typegenOptions.debounceMs !== undefined ? { debounceMs: typegenOptions.debounceMs } : {}),
      // Only subscribe for incremental regen in dev; build is one-shot.
      ...(isServe ? { channel: makeContentChannel(r) } : {}),
    });
    return typegen;
  };

  /** Rewrite `contentia:` globs in `code`, or `null` when there is nothing to do. */
  const transformGlobs = async (code: string) => {
    if (!code.includes('import.meta.glob') || !code.includes('contentia:')) return null;
    const rewritten = await rewriteContentiaGlobs(code, getRepos());
    return rewritten === null ? null : { code: rewritten.code, map: rewritten.map };
  };

  return {
    name: '@contentia/vite-plugin',
    // Run before Vite's native `import.meta.glob` transform so contentia patterns
    // are rewritten before the core plugin rejects them as non-filesystem.
    enforce: 'pre',

    config() {
      // Vite's dependency scanner runs a fixed, minimal plugin pipeline: user
      // `transform` hooks are skipped there, so an un-rewritten `contentia:` glob
      // reaches Vite's own glob transform, which rejects it and fails the whole
      // scan — dev then starts with dependency pre-bundling silently disabled.
      // `optimizeDeps.rolldownOptions.plugins` IS honoured by the scanner, and
      // runs ahead of its built-ins, so register the same rewrite there.
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [{
              name: '@contentia/vite-plugin:scan',
              transform: {
                filter: { code: 'import.meta.glob' },
                handler: (code: string) => transformGlobs(code),
              },
            }],
          },
        },
      };
    },

    configResolved(config) {
      root = config.root;
      isServe = config.command === 'serve';
    },

    async buildStart() {
      writtenChunks.clear();
      const tg = getTypegen();
      if (!tg) return;
      // In dev, don't block server start on a full type sweep.
      if (isServe) void tg.regenerateAll().catch(() => {});
      else await tg.regenerateAll();
    },

    resolveId(source) {
      if (isVirtualId(source)) return source;
      if (isContentiaSource(source)) return toVirtualId(parseContentiaId(source));
      return null;
    },

    async load(id) {
      if (!isVirtualId(id)) return null;
      const contentiaId = parseContentiaId(id);
      const { content, meta } = await readItem(getRepos(), contentiaId);
      // Type the item from the data we just read (no extra fetch).
      const tg = getTypegen();
      if (tg) await tg.ingest(contentiaId, content, meta);
      // Write the chunk before returning: the module we hand back imports it, so
      // it has to be on disk by the time the bundler resolves that import.
      const body = mdxEnabled ? bodyOf(content) : null;
      if (body !== null) {
        await writeChunk(root, contentiaId, body);
        writtenChunks.add(chunkPath(root, contentiaId));
      }
      return {
        code: renderModule({
          content,
          meta,
          ...(body !== null ? { mdxSpecifier: chunkSpecifier(contentiaId) } : {}),
        }),
        map: null,
      };
    },

    async transform(code) {
      return transformGlobs(code);
    },

    configureServer(server) {
      if (hmrEnabled) {
        const dispose = createRepositoryChangeChannel(getRepos(), server, {
          coarse: hmrCoarse,
          ...(mdxEnabled ? { bodies: { root } } : {}),
        });
        server.httpServer?.once('close', dispose);
      }
      // Construct the typegen instance (subscribes to the change channel in dev).
      getTypegen();
      server.httpServer?.once('close', () => void typegen?.dispose());

      // Local mode: mount Contentia's own JSON:API over the plugin's repositories.
      // Dev-server-only by construction — no build/preview equivalent exists.
      if (options.localApi) mountLocalApi(server, getRepos(), options.localApi);
    },

    async closeBundle() {
      // Every chunk the build needed has been written by now, so anything else
      // under `.contentia/vite-generated/bodies` belongs to a key that no longer exists. Build
      // only: in dev this hook fires when the server closes.
      if (mdxEnabled && !isServe) await pruneChunks(root, writtenChunks);
      await typegen?.dispose();
    },
  };
}

export default contentia;
