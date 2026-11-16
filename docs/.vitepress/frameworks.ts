/**
 * The frameworks a reader can pick. Framework-specific content is wrapped in `::: fw <id> [<id> …]`
 * containers; only containers listing the picked id are shown, so a reader never sees another
 * framework's code or notes. Every run of adjacent containers gets a switcher with these icons
 * (theme/FrameworkTabs.vue); a pick in any switcher applies to every page and is remembered.
 */
export const FRAMEWORKS = [
  { id: 'node', label: 'Node.js', group: 'No framework' },
  { id: 'bun', label: 'Bun', group: 'No framework' },
  { id: 'deno', label: 'Deno', group: 'No framework' },
  { id: 'workers', label: 'Cloudflare Workers', group: 'No framework' },
  { id: 'hono', label: 'Hono', group: 'Server' },
  { id: 'express', label: 'Express', group: 'Server' },
  { id: 'fastify', label: 'Fastify', group: 'Server' },
  { id: 'nextjs', label: 'Next.js', group: 'Full-stack' },
  { id: 'sveltekit', label: 'SvelteKit', group: 'Full-stack' },
  { id: 'nuxt', label: 'Nuxt', group: 'Full-stack' },
  { id: 'astro', label: 'Astro', group: 'Full-stack' },
  { id: 'vitepress', label: 'VitePress', group: 'Docs site (dev server)' },
  { id: 'docusaurus', label: 'Docusaurus', group: 'Docs site (dev server)' },
] as const;

export type FrameworkId = typeof FRAMEWORKS[number]['id'];

export const DEFAULT_FRAMEWORK: FrameworkId = 'node';

/** Where the reader's pick is remembered, per browser. */
export const FRAMEWORK_STORAGE_KEY = 'contentia:framework';

const ids: ReadonlySet<string> = new Set(FRAMEWORKS.map(f => f.id));

export const isFrameworkId = (value: unknown): value is FrameworkId => typeof value === 'string' && ids.has(value);

/**
 * Inline `<head>` script: applies the stored pick before first paint, so the page never shows
 * another framework's content first. Unknown or missing values fall back to the default.
 */
export const applyFrameworkScript = `(() => {
  let id;
  try { id = localStorage.getItem(${JSON.stringify(FRAMEWORK_STORAGE_KEY)}); } catch {}
  const known = ${JSON.stringify([...ids])};
  document.documentElement.dataset.framework = known.includes(id) ? id : ${JSON.stringify(DEFAULT_FRAMEWORK)};
})();`;

/**
 * Driven by `html[data-framework]` alone, so it is right before first paint: hide every container
 * that doesn't list the picked framework, and mark the picked framework in every switcher.
 */
export const frameworkCss = [
  FRAMEWORKS.map(({ id }) => `html[data-framework="${id}"] .fw:not([data-fw~="${id}"])`).join(',\n')
  + ' { display: none; }',
  FRAMEWORKS.map(({ id }) => `html[data-framework="${id}"] .fw-tab[data-fw="${id}"]`).join(',\n')
  + ' { color: var(--vp-c-bg); background: var(--vp-c-text-1); border-color: var(--vp-c-text-1); }',
  FRAMEWORKS.map(({ id }) => `html[data-framework="${id}"] .fw-tab-name[data-fw="${id}"]`).join(',\n')
  + ' { display: inline; }',
].join('\n');
