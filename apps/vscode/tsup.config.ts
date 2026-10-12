import { defineConfig } from 'tsup';

// VS Code loads extensions as CommonJS from a single file. tsup bundles
// devDependencies, and every dependency here is one, so the packaged extension
// has no node_modules of its own. Only `vscode` comes from the extension host.
export default defineConfig({
  entry: { extension: 'src/extension.ts' },
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  external: ['vscode'],
});
