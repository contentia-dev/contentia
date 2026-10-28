import type { StorageProvider } from 'contentia/storage';

export type FileSystemStorageProvider = StorageProvider & 'filesystem';

export const fileSystemStorageProvider: FileSystemStorageProvider = 'filesystem' as FileSystemStorageProvider;
