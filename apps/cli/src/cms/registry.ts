/**
 * The admin UIs whose config `contentia local generate` can read. Adding a CMS
 * means writing a sibling of `./decap.ts` and listing it here; the `--cms`
 * flag reads this array. The first entry is the default.
 */

import { decapAdapter } from './decap.js';
import type { CmsAdapter } from './types.js';

export const cmsAdapters: readonly CmsAdapter[] = [decapAdapter];

export const DEFAULT_CMS_ADAPTER: CmsAdapter = cmsAdapters[0];

/** Look up an adapter by name, or `undefined` when nothing matches. */
export const findCmsAdapter = (name: string): CmsAdapter | undefined =>
  cmsAdapters.find(adapter => adapter.name === name);

/** Look up an adapter by name, throwing an error that lists the valid names. */
export function getCmsAdapter(name: string): CmsAdapter {
  const adapter = findCmsAdapter(name);
  if (!adapter) {
    throw new Error(
      `Unknown CMS "${name}". Available: ${cmsAdapters.map(item => item.name).join(', ')}`,
    );
  }
  return adapter;
}
