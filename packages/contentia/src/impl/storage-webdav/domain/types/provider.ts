import type { StorageProvider } from 'contentia/storage';

/** Branded {@link StorageProvider} identifier for the WebDAV implementation. */
export type WebDavStorageProvider = StorageProvider & 'webdav';

/** Canonical instance of {@link WebDavStorageProvider}. */
export const webDavStorageProvider: WebDavStorageProvider = 'webdav' as WebDavStorageProvider;
