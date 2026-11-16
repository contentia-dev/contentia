import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // 'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // API reference examples: each ends on the call it demonstrates, so its result is unused.
    files: ['docs/reference/examples/*/**'],
    rules: { '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    ignores: [
      // Standalone examples workspace — not part of this pnpm project
      'examples/**',
      // Assembled apex site (website + docs) for Cloudflare Pages
      '**/dist/**',
      '**/dist-test/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/.wrangler/**',
      '**/.vendor/**',
      '**/tmp/**',
      '**/coverage/**',
      '**/build/**',
      '**/worker-configuration.d.ts',
      '**/next-env.d.ts',
      // @contentia/vite-plugin typegen output + its committed one-line reference
      '**/.contentia/**',
      '**/contentia-env.d.ts',
      'types/**',
      // Framework-generated artifact directories — never manually edited
      '**/.astro/**',
      '**/.next/**',
      '**/.svelte-kit/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.vinxi/**',
      '**/.cache/**',
      // Built static assets (esbuild bundles, etc.)
      '**/public/admin/bundle.js',
      '**/static/admin/bundle.js',
      // Other framework-generated artifact directories
      '**/.marko-run/**',
      '**/.nitro/**',
      'docs/.vitepress/cache/**',
    ],
  },
);
