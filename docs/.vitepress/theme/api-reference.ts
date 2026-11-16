/**
 * Setup shared by the API reference pages: vitepress-openapi's `<OASpec>`, laid out like Stripe's
 * reference. vitepress-openapi is loaded with a dynamic import from the pages, not by the theme: in
 * the theme its client bundle (about 2 MB) would load on every page, and imported statically by a
 * page it would be bundled into that page's chunk, whose dynamic imports (one per syntax-
 * highlighting language, about 8 MB) VitePress then preloads. Vue still renders the async
 * component at build time, so the reference is in the static HTML.
 */
import 'vitepress-openapi/dist/style.css';
import { type App, type Component, defineAsyncComponent, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue';

import './api-reference.css';
import { syncCodeSampleTabs } from './code-sample-tabs';

const installed = new WeakSet<App>();

/** Call from a reference page's `<script setup>`; render the returned component as `<OASpec>`. */
export function useApiReference(): Component {
  const app = getCurrentInstance()!.appContext.app;
  let stopSync = () => {};
  onMounted(() => {
    stopSync = syncCodeSampleTabs(document.querySelector('.vp-doc')!);
  });
  onBeforeUnmount(() => stopSync());
  return defineAsyncComponent(async () => {
    const { OASpec, theme, useTheme } = await import('vitepress-openapi/client');
    if (!installed.has(app)) {
      installed.add(app);
      theme.enhanceApp({ app });
    }
    useTheme({
      operation: { hiddenSlots: ['playground', 'branding'] },
      spec: { showPathsSummary: false },
      // The page title is the only h1: sections and operations are h2, their parts h3.
      headingLevels: { h1: 2, h2: 3, h3: 4, h4: 5, h5: 6, h6: 6 },
    });
    return OASpec;
  });
}
