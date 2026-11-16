import { describe, expect, it } from 'vitest';

import { NotImplementedError } from '../../../../shared/core/index.js';
import { SyncToken } from '../../../storage/index.js';

import { DocumentsRepository } from './document-repository.js';

// A subclass that implements none of the change-signal surface: the
// non-abstract base defaults must kick in. Object.create skips the abstract
// members without having to stub all of them.
const bareRepo = (): DocumentsRepository => Object.create(DocumentsRepository.prototype) as DocumentsRepository;

describe('DocumentsRepository change-signal defaults', () => {
  it('getSyncToken fails with NotImplementedError by default', async () => {
    await expect(bareRepo().getSyncToken().run()).rejects.toMatchObject({
      code: NotImplementedError.CODE,
    });
  });

  it('getSyncToken with a folder scope also fails with NotImplementedError', async () => {
    await expect(bareRepo().getSyncToken({ folder: 'posts' }).run()).rejects.toMatchObject({
      code: NotImplementedError.CODE,
    });
  });

  it('listChanges fails with NotImplementedError by default', async () => {
    await expect(
      bareRepo().listChanges({ since: SyncToken.make('0') }).collect(),
    ).rejects.toMatchObject({ code: NotImplementedError.CODE });
  });
});
