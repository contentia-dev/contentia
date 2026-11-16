import { describe, expect, it } from 'vitest';

import { ContentiaStream, NotFoundError } from 'contentia/core';

import { jsonSerializer } from '../../../../serializers/storage-serializers-json/index.js';
import { InMemoryS3Client, inMemoryS3Commands } from '../../testing.js';
import { CREATED_AT_METADATA_KEY } from '../datasources/s3-datasource.js';
import { S3StorageRepository } from './s3-storage-repository.js';

const BUCKET = 'content';

const setup = (options: { keyPrefix?: string } = {}) => {
  const client = new InMemoryS3Client();
  const repo = new S3StorageRepository(
    { client, bucket: BUCKET, commands: inMemoryS3Commands, keyPrefix: options.keyPrefix },
    { json: jsonSerializer },
    'json',
  );
  return { client, repo, objects: client.bucket(BUCKET) };
};

const commandNames = (client: InMemoryS3Client) => client.sent.map(c => c.constructor.name);

describe('S3StorageRepository — timestamps', () => {
  it('reads createdAt/updatedAt from S3 LastModified and metadata', async () => {
    const { repo } = setup();
    const created = await repo.createObject({ key: 'posts/a', type: 'object', content: { n: 1 } });
    // A missing timestamp parses as NaN, so these still fail when it is absent.
    expect(Number.isNaN(Date.parse(created.createdAt ?? ''))).toBe(false);
    expect(Number.isNaN(Date.parse(created.updatedAt ?? ''))).toBe(false);
  });

  it('reads objects written by other tools (no contentia metadata) using LastModified', async () => {
    const { repo, objects } = setup();
    const lastModified = new Date('2026-03-04T05:06:07Z');
    objects.set('external.json', { body: '{"x":1}', metadata: {}, lastModified, etag: '"e"' });

    const object = await repo.getObject('external');
    expect(object.content).toEqual({ x: 1 });
    expect(object.createdAt).toBe(lastModified.toISOString());
    expect(object.updatedAt).toBe(lastModified.toISOString());
  });

  it('keeps createdAt across updateObject', async () => {
    const { repo } = setup();
    const created = await repo.createObject({ key: 'item', type: 'object', content: { v: 1 } });
    await repo.updateObject({ key: 'item', content: { v: 2 } });

    const after = await repo.getObject('item');
    expect(after.content).toEqual({ v: 2 });
    expect(after.createdAt).toBe(created.createdAt);
    expect(after.updatedAt).not.toBe(created.createdAt);
  });

  it('keeps createdAt across createOrUpdateObject overwrites', async () => {
    const { repo } = setup();
    const created = await repo.createObject({ key: 'item', type: 'object', content: { v: 1 } });
    await repo.createOrUpdateObject({ key: 'item', type: 'object', content: { v: 2 } });

    const after = await repo.getObject('item');
    expect(after.content).toEqual({ v: 2 });
    expect(after.createdAt).toBe(created.createdAt);
  });
});

describe('S3StorageRepository — requests', () => {
  it('writes ContentType and the created-at user metadata', async () => {
    const { repo, objects } = setup();
    await repo.createObject({ key: 'a', type: 'object', content: { n: 1 } });

    const stored = objects.get('a.json')!;
    expect(stored.contentType).toBe('application/json');
    expect(Number.isNaN(Date.parse(stored.metadata[CREATED_AT_METADATA_KEY]!))).toBe(false);
  });

  it('reads an object with a single GET', async () => {
    const { repo, client } = setup();
    await repo.createObject({ key: 'a', type: 'object', content: { n: 1 } });
    client.sent.length = 0;

    await repo.getObject('a');
    expect(commandNames(client)).toEqual(['GetObjectCommand']);
  });

  it('scopes every key under keyPrefix and hides it from callers', async () => {
    const { repo, objects } = setup({ keyPrefix: '/tenant-a/' });
    await repo.createObject({ key: 'docs/a', type: 'object', content: { n: 1 } });
    await repo.createFolder({ key: 'empty', type: 'folder' });

    expect([...objects.keys()].sort()).toEqual(['tenant-a/docs/a.json', 'tenant-a/empty/.keep']);
    const listed = await ContentiaStream.runPromiseCollect(
      repo.listAtomSummaries('', { depth: 2, pagination: { offset: 0, limit: 100 } }),
    );
    expect(listed.data.map(s => s.key).sort()).toEqual(['docs', 'docs/a', 'empty']);
    expect((await repo.getObject('docs/a')).key).toBe('docs/a');
  });
});

describe('S3StorageRepository — listing', () => {
  it('follows continuation tokens past a 1000-key page', async () => {
    const { repo, objects } = setup();
    for (let i = 0; i < 1005; i++) {
      objects.set(`many/item-${i}.json`, { body: '{}', metadata: {}, lastModified: new Date(), etag: '"e"' });
    }
    const listed = await ContentiaStream.runPromiseCollect(
      repo.listAtomSummaries('many', { depth: 1, pagination: { offset: 0, limit: 10 } }),
    );
    expect(listed.done.total).toBe(1005);
    expect(listed.data).toHaveLength(10);
  });

  it('treats an S3-console folder placeholder as an existing, empty folder', async () => {
    const { repo, objects } = setup();
    objects.set('uploads/', { body: '', metadata: {}, lastModified: new Date(), etag: '"e"' });

    const listed = await ContentiaStream.runPromiseCollect(
      repo.listAtoms('uploads', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(listed.data).toEqual([]);
    expect(listed.recoverableErrors).toEqual([]);
    expect((await repo.getFolder('uploads')).type).toBe('folder');
  });

  it('reports a missing folder as a recoverable NotFoundError', async () => {
    const { repo } = setup();
    const listed = await ContentiaStream.runPromiseCollect(
      repo.listAtoms('nope', { depth: 1, pagination: { offset: 0, limit: 100 } }),
    );
    expect(listed.done.total).toBe(0);
    expect(listed.recoverableErrors).toHaveLength(1);
    expect(listed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('S3StorageRepository — errors', () => {
  it('does not treat a 403 as a missing object', async () => {
    const client = new InMemoryS3Client();
    client.send = async () => {
      throw Object.assign(new Error('Forbidden'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    };
    const repo = new S3StorageRepository(
      { client, bucket: BUCKET, commands: inMemoryS3Commands },
      { json: jsonSerializer },
      'json',
    );
    await expect(repo.getObject('a').run()).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('removeAtoms skips keys that do not exist', async () => {
    const { repo } = setup();
    await repo.createObject({ key: 'a', type: 'object', content: { n: 1 } });
    const removed = await ContentiaStream.runPromiseCollect(repo.removeAtoms(['a', 'missing']));
    expect(removed.data).toEqual(['a']);
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
  });
});
