import { contentia } from '@contentia/astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  // The integration serves Contentia's JSON:API to the Decap admin while `astro dev`
  // is running, and refreshes content collections when a post changes. It does
  // nothing during `astro build`, so the built site has no CMS dependency.
  integrations: [contentia({ dir: 'content', defaultExtension: 'md' })],
  vite: {
    build: { cssMinify: 'esbuild' },
  },
});
