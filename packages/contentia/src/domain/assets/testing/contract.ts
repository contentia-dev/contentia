import type { Asset, AssetsRepository, Resource } from 'contentia/assets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../../shared/core/index.js';

export type AssetsContractCapability =
  | 'createAsset'
  | 'updateAsset'
  | 'deleteAsset'
  | 'deleteAssets'
  | 'deleteAssetsTracksSkipped'
  | 'listResources'
  | 'getResource'
  | 'createFolder'
  | 'getFolder'
  | 'deleteFolder'
  | 'getUrls'
  | 'getMetadata'
  | 'getVariations';

export interface AssetsContractCase {
  name: string;
  makeRepo: () => AssetsRepository | Promise<AssetsRepository>;
  teardown?: () => void | Promise<void>;
  skip?: AssetsContractCapability[];
  /**
   * Optional folder prefix all keys are created under. Some impls require keys
   * to live inside a configured collection. Defaults to 'uploads'.
   */
  collectionFolder?: string;
}

const DEFAULT_PAGINATION = { offset: 0, limit: 100 };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function runAssetsRepositoryContract(testCase: AssetsContractCase): void {
  const { name, makeRepo, teardown, skip = [], collectionFolder = 'uploads' } = testCase;

  describe(`AssetsRepository contract: ${name}`, () => {
    let repo: AssetsRepository;

    beforeAll(async () => {
      repo = await makeRepo();
    });

    if (teardown) {
      afterAll(async () => {
        await teardown();
      });
    }

    const itOrSkip = (capability: AssetsContractCapability) => skip.includes(capability) ? it.skip : it;

    const keyIn = (slug: string) => `${collectionFolder}/${slug}`;

    it('getCapabilities: returns a Capabilities value', async () => {
      const caps = await repo.getCapabilities();
      expect(caps).toBeDefined();
      expect(typeof caps.compatibilityDate).toBe('string');
      expect(caps.pagination).toBeDefined();
      expect(caps.versionTracking).toBeDefined();
      expect(caps.changes).toBeDefined();
    });

    // --- createAsset then getAsset ---
    itOrSkip('createAsset')('createAsset then getAsset: returns matching key + asset type', async () => {
      const key = keyIn(`create-${Date.now()}.png`);
      const created: Asset = await repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' });
      expect(created.key).toBe(key);
      expect(created.type).toBe('asset');

      const fetched: Asset = await repo.getAsset(key);
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('asset');
    });

    // --- updateAsset (metadata only) ---
    itOrSkip('updateAsset')('updateAsset: returns the asset (metadata change does not throw)', async () => {
      const key = keyIn(`update-${Date.now()}.png`);
      await repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' });

      const updated: Asset = await repo.updateAsset({ key, customMetadata: { tag: 'v2' } });
      expect(updated.key).toBe(key);
      expect(updated.type).toBe('asset');
    });

    // --- deleteAsset ---
    itOrSkip('deleteAsset')('deleteAsset: subsequent getAsset fails with NotFoundError', async () => {
      const key = keyIn(`delete-${Date.now()}.png`);
      await repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' });
      await repo.deleteAsset(key);

      await expect(repo.getAsset(key).run()).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- deleteAssets bulk ---
    itOrSkip('deleteAssets')('deleteAssets: removes existing keys (removed > 0)', async () => {
      const stamp = Date.now();
      const k1 = keyIn(`bulk-${stamp}-1.png`);
      const k2 = keyIn(`bulk-${stamp}-2.png`);
      await repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' });
      await repo.createAsset({ key: k2, content: PNG_BYTES, mimeType: 'image/png' });

      const { done } = await repo.deleteAssets([k1, k2]).collect();
      expect(done.removed).toBeGreaterThan(0);
    });

    itOrSkip('deleteAssetsTracksSkipped')('deleteAssets: missing key reports skipped > 0', async () => {
      const missing = keyIn(`missing-${Date.now()}.png`);
      const { done } = await repo.deleteAssets([missing]).collect();
      expect(done.skipped).toBeGreaterThan(0);
    });

    // --- listResources ---
    itOrSkip('listResources')('listResources after create: returns created keys', async () => {
      const stamp = Date.now();
      const folder = `${collectionFolder}/list-${stamp}`;
      const keys = [`${folder}/a.png`, `${folder}/b.png`, `${folder}/c.png`];
      for (const key of keys) {
        await repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' });
      }

      const { items } = await repo.listResources(folder, { depth: 1, pagination: DEFAULT_PAGINATION }).collect();
      const returnedKeys = (items as Resource[]).map(r => r.key);
      for (const key of keys) {
        expect(returnedKeys).toContain(key);
      }
    });

    // --- getResource ---
    itOrSkip('getResource')('getResource for an asset: returns at least one entry with matching key', async () => {
      const key = keyIn(`resource-${Date.now()}.png`);
      await repo.createAsset({ key, content: PNG_BYTES, mimeType: 'image/png' });

      const resources = await repo.getResource(key);
      expect(Array.isArray(resources)).toBe(true);
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.some(r => r.key === key)).toBe(true);
    });

    // --- createFolder / getFolder ---
    itOrSkip('createFolder')('createFolder then getFolder: returns the folder', async () => {
      const key = `${collectionFolder}/folder-${Date.now()}`;
      const created = await repo.createFolder({ key, type: 'folder' });
      expect(created.type).toBe('folder');
      expect(created.key).toBe(key);

      const fetched = await repo.getFolder(key);
      expect(fetched.key).toBe(key);
      expect(fetched.type).toBe('folder');
    });

    // --- deleteFolder ---
    itOrSkip('deleteFolder')('deleteFolder: subsequent getFolder fails with NotFoundError', async () => {
      const key = `${collectionFolder}/folder-del-${Date.now()}`;
      await repo.createFolder({ key, type: 'folder' });
      await repo.deleteFolder(key, true);

      await expect(repo.getFolder(key).run()).rejects.toMatchObject({ code: NotFoundError.CODE });
    });

    // --- getUrls ---
    itOrSkip('getUrls')('getUrls: yields one entry per asset', async () => {
      const k1 = keyIn(`urls-${Date.now()}-1.png`);
      const k2 = keyIn(`urls-${Date.now()}-2.png`);
      const a1 = await repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' });
      const a2 = await repo.createAsset({ key: k2, content: PNG_BYTES, mimeType: 'image/png' });

      const { items } = await repo.getUrls([a1, a2]).collect();
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(2);
    });

    // --- getMetadata ---
    itOrSkip('getMetadata')('getMetadata: yields one entry per asset', async () => {
      const k1 = keyIn(`meta-${Date.now()}-1.png`);
      const a1 = await repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' });

      const { items } = await repo.getMetadata([a1]).collect();
      expect(items.length).toBeGreaterThan(0);
    });

    // --- getVariations ---
    itOrSkip('getVariations')('getVariations: yields one entry per asset with a Record variations map', async () => {
      const k1 = keyIn(`var-${Date.now()}-1.png`);
      const a1 = await repo.createAsset({ key: k1, content: PNG_BYTES, mimeType: 'image/png' });

      const { items } = await repo.getVariations([a1]).collect();
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        expect(item.key).toBeDefined();
        expect(item.variations).toBeDefined();
        // variations must be a plain object (Record), never an array
        expect(Array.isArray(item.variations)).toBe(false);
        expect(typeof item.variations).toBe('object');
        // each variation value (if any) must have at least a variant and url string
        for (const [, variation] of Object.entries(item.variations)) {
          expect(typeof variation.variant).toBe('string');
          expect(typeof variation.url).toBe('string');
        }
      }
    });
  });
}
