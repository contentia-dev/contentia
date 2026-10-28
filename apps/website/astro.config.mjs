import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { contentia } from '@contentia/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://contentia.dev',
  integrations: [contentia({ dir: 'content', defaultExtension: 'yaml' }), mdx(), react()],
  server: { port: 3300 },
  build: { format: 'directory' },
  // Blog posts render through Astro's markdown pipeline. Both themes are emitted
  // so the `.dark` class can switch code blocks without a reload (styles.css).
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
