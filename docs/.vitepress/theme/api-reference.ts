/**
 * Setup shared by the API reference pages: vitepress-openapi's `<OASpec>`, laid out like Stripe's
 * reference. vitepress-openapi is loaded with a dynamic import from the pages, not by the theme: in
 * the theme its client bundle (about 2 MB) would load on every page, and imported statically by a
 * page it would be bundled into that page's chunk, whose dynamic imports (one per syntax-
 * highlighting language, about 8 MB) VitePress then preloads. Vue still renders the async
 * component at build time, so the reference is in the static HTML.
 *
 * Each operation's endpoint bar is ours (`try-it/ApiEndpoint.vue`): its Try it button opens a
 * request window, whose requests `api-sandbox.ts` answers in the browser.
 */
import 'vitepress-openapi/dist/style.css';
import {
  type App,
  type Component,
  defineAsyncComponent,
  defineComponent,
  getCurrentInstance,
  h,
  onBeforeUnmount,
  onMounted,
} from 'vue';

import './api-reference.css';
import { installSandbox } from './api-sandbox';
import { syncCodeSampleTabs } from './code-sample-tabs';
import ApiEndpoint from './try-it/ApiEndpoint.vue';
import type { Spec } from './try-it/request-model';

/** What `<OASpec>` passes an operation's `path` slot. */
interface EndpointSlotProps {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly deprecated?: boolean;
}

const installed = new WeakSet<App>();

/** Call from a reference page's `<script setup>`; render the returned component as `<OASpec>`. */
export function useApiReference(): Component {
  const app = getCurrentInstance()!.appContext.app;
  let stopSync = () => {};
  onMounted(() => {
    stopSync = syncCodeSampleTabs(document.querySelector('.vp-doc')!);
    // The request window's requests are answered in the browser.
    installSandbox();
  });
  onBeforeUnmount(() => stopSync());
  return defineAsyncComponent(async () => {
    const { OASpec, theme, useTheme } = await import('vitepress-openapi/client');
    if (!installed.has(app)) {
      installed.add(app);
      theme.enhanceApp({ app });
    }
    useTheme({
      // No built-in playground: each endpoint bar's Try it button opens our request window.
      operation: { hiddenSlots: ['playground', 'branding'] },
      spec: { showPathsSummary: false },
      // The page title is the only h1: sections and operations are h2, their parts h3.
      headingLevels: { h1: 2, h2: 3, h3: 4, h4: 5, h5: 6, h6: 6 },
    });
    // `<OASpec>` with our endpoint bar in each operation's `path` slot. A page's own slots win.
    return defineComponent({
      inheritAttrs: false,
      setup(_, { attrs, slots }) {
        return () =>
          h(OASpec, attrs, {
            path: (props: EndpointSlotProps) =>
              h(ApiEndpoint, {
                spec: attrs.spec as Spec,
                operationId: props.operationId,
                method: props.method,
                path: props.path,
                deprecated: props.deprecated,
              }),
            ...slots,
          });
      },
    });
  });
}
