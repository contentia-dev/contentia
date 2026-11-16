/**
 * Decap CMS backend for Contentia: register it with `CMS.registerBackend('contentia',
 * createContentiaBackend())` and the Decap admin reads and writes content through the Contentia
 * JSON:API (`contentia/server/api`).
 */
import PKCEAuthenticationPage from './authentication-page.js';
import createContentiaBackend from './contentia-backend.js';
import DevAuthenticationPage from './dev-authentication-page.js';

export type { PKCEAuthPageProps } from './authentication-page.js';
export {
  ACCESS_TOKEN_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  TOKEN_EXPIRES_AT_STORAGE_KEY,
} from './contentia-backend.js';
export type {
  ContentiaBackendConfig,
  CreateContentiaBackendOptions,
  GetAssetsRepositoryOptions,
  GetDocumentsRepositoryOptions,
} from './contentia-backend.js';
export type { DevAuthPageProps } from './dev-authentication-page.js';
export {
  DEFAULT_LOCAL_BACKEND_BASE_PATH,
  DEFAULT_LOCAL_BACKEND_DEV_TOKEN,
  resolveContentiaBackend,
} from './resolve-contentia-backend.js';
export type {
  ContentiaBackendModuleConfig,
  LocalContentiaBackendOptions,
  ResolveContentiaBackendOptions,
} from './resolve-contentia-backend.js';

export { createContentiaBackend, DevAuthenticationPage, PKCEAuthenticationPage };
export default createContentiaBackend;
