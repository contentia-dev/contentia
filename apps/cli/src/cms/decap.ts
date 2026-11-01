/**
 * The Decap CMS adapter: typed-config codegen for a Decap `config.yml`.
 *
 * Everything Decap-shaped stays behind the {@link CmsAdapter} interface, so a
 * second admin UI is a sibling file plus one line in `./registry.ts`.
 */

import path from 'node:path';

import { discoverConfig, generateConfig } from './decap-config.js';
import type { CmsAdapter } from './types.js';

export const decapAdapter: CmsAdapter = {
  name: 'decap',
  title: 'Decap CMS',
  description: 'A Decap CMS config.yml',
  config: {
    discover: discoverConfig,
    defaultOutput: input => path.join(path.dirname(input), 'config.gen.ts'),
    generate: generateConfig,
  },
};
