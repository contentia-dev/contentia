// Build-time list of the adapters for the homepage (marquee, backend switcher, diagrams). Read from
// the root adapters.yaml, the same source the adapter pages are generated from, so a new adapter
// shows up here without touching the homepage.
import { readFileSync } from 'node:fs';

import { load as parseYaml } from 'js-yaml';
import { defineLoader } from 'vitepress';

export interface Adapter {
  key: string;
  name: string;
}

declare const data: Adapter[];
export { data };

export default defineLoader({
  watch: ['../../../../adapters.yaml'],
  load([file]): Adapter[] {
    const entries = parseYaml(readFileSync(file!, 'utf8')) as Adapter[];
    return entries.map(({ key, name }) => ({ key, name }));
  },
});
