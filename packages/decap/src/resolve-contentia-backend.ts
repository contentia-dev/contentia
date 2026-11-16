/**
 * `resolveContentiaBackend({ local, remote })` selects the Decap `backend:`
 * config on whether the admin is running inside a Vite dev build, so a single
 * admin config targets the local JSON:API `@contentia/vite-plugin` mounts under
 * `localApi` while iterating, and the remote OAuth backend
 * `createContentiaBackend` drives everywhere else, with no manual switching.
 *
 * `createContentiaBackend` and `DevAuthenticationPage` remain public (exported
 * from `./index.js`) so a caller can hand-wire a custom local/remote
 * arrangement instead of using this helper.
 */

/**
 * The subset of the Decap `backend:` config block this module reads or builds.
 * Decap's own `CmsBackend['name']` type is a closed union that does not include
 * `'contentia'`, so this interface mirrors the config as written instead of
 * fighting that type.
 */
export interface ContentiaBackendModuleConfig {
  name: 'contentia';
  base_url: string;
  api_root?: string;
  /** Folder in the assets repository that holds the media library. Defaults to `media_folder`. */
  assets_folder?: string;
  app_id?: string;
  auth_endpoint?: string;
  auth_token_endpoint?: string;
  auth_token_endpoint_content_type?: string;
  use_oidc?: boolean;
  /** Pre-shared token that skips the PKCE OAuth dance. See `ContentiaBackend.devToken`. */
  dev_token?: string;
  acceptRoles?: string[];
  [key: string]: unknown;
}

/**
 * Base path the local JSON:API mounts under. Must match the `localApi.basePath`
 * configured on `@contentia/vite-plugin` (or its default,
 * `DEFAULT_LOCAL_API_BASE_PATH`); duplicated here rather than imported so this
 * package keeps no runtime dependency on the plugin.
 */
export const DEFAULT_LOCAL_BACKEND_BASE_PATH = '/__contentia';

/** Dummy token `DevAuthenticationPage` submits when no `devToken` override is given. */
export const DEFAULT_LOCAL_BACKEND_DEV_TOKEN = 'contentia-local-dev';

export interface LocalContentiaBackendOptions {
  /**
   * Base path the local JSON:API is mounted at. Defaults to
   * {@link DEFAULT_LOCAL_BACKEND_BASE_PATH}, the Vite plugin's default.
   */
  basePath?: string;
  /**
   * Dummy token `DevAuthenticationPage` submits. Local mode performs no real
   * auth, so this only needs to be non-empty and stable across reloads.
   * Defaults to {@link DEFAULT_LOCAL_BACKEND_DEV_TOKEN}.
   */
  devToken?: string;
}

export interface ResolveContentiaBackendOptions {
  /**
   * Local-mode overrides, applied when the dev flag is truthy. Optional: omit
   * to use the {@link DEFAULT_LOCAL_BACKEND_BASE_PATH} /
   * {@link DEFAULT_LOCAL_BACKEND_DEV_TOKEN} defaults.
   */
  local?: LocalContentiaBackendOptions;
  /**
   * The remote backend config, the `backend:` block built for the OAuth flow
   * `createContentiaBackend` drives. Returned as-is whenever the dev flag is not
   * truthy.
   */
  remote: ContentiaBackendModuleConfig;
  /**
   * Override for `import.meta.env.DEV`. Real call sites can omit this, since it
   * is read directly, so tests are the only ones expected to pass it, to
   * exercise both branches deterministically without a bundler. Anything falsy
   * (including when `import.meta.env` itself is not defined, e.g. outside a Vite
   * build) fails safe to `remote`.
   */
  dev?: boolean;
}

/** Read `import.meta.env.DEV` defensively: `false` when Vite has not substituted it. */
function readViteDevFlag(): boolean {
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  return Boolean(meta.env?.DEV);
}

/**
 * Select the Decap `backend:` config for the current build: the local JSON:API
 * while `vite dev` is running, the remote OAuth backend everywhere else.
 *
 * Fails safe to `remote` whenever the dev flag is not truthy, so an admin loaded
 * outside a Vite-bundled dev context (a production build, a standalone admin,
 * `vite preview`) never targets a phantom local endpoint. Local mode only
 * engages when the admin config itself is built by Vite, so `import.meta.env.DEV`
 * is reliably substituted.
 */
export function resolveContentiaBackend(options: ResolveContentiaBackendOptions): ContentiaBackendModuleConfig {
  const dev = options.dev ?? readViteDevFlag();
  if (!dev) return options.remote;

  const { basePath = DEFAULT_LOCAL_BACKEND_BASE_PATH, devToken = DEFAULT_LOCAL_BACKEND_DEV_TOKEN } = options.local
    ?? {};

  return {
    name: 'contentia',
    base_url: basePath,
    api_root: '',
    dev_token: devToken,
  };
}
