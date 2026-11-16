/**
 * The repositories the API reference's Node.js examples call. The reference shows the `setup`
 * region once, in its introduction, and drops each example's `import … from '../setup.js'` line.
 */
// #region setup
import { jsonSerializer } from 'contentia/serializers/json';
import { FileSystemStorageRepository } from 'contentia/storage/fs';

export const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
// #endregion setup
