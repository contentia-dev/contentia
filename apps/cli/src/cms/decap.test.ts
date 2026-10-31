import { describe, expect, it } from 'vitest';

import { decapAdapter } from './decap.js';
import { DEFAULT_CMS_ADAPTER, findCmsAdapter, getCmsAdapter } from './registry.js';

describe('cms registry', () => {
  it('resolves adapters by name and defaults to the first one', () => {
    expect(DEFAULT_CMS_ADAPTER).toBe(decapAdapter);
    expect(getCmsAdapter('decap')).toBe(decapAdapter);
    expect(findCmsAdapter('nope')).toBeUndefined();
    expect(() => getCmsAdapter('nope')).toThrow(/Unknown CMS "nope"\. Available: decap/);
  });
});
