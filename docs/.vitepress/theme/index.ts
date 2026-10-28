import { type Theme, useRoute } from 'vitepress';
import { type App, defineAsyncComponent, nextTick, onMounted, watch } from 'vue';

import { Ink } from './ink';
import './custom.css';

// Imported lazily so mermaid stays out of the server build and off pages without diagrams.
const renderMermaid = () => nextTick(() => import('./mermaid').then(m => m.renderMermaid()));

export default {
  extends: Ink,
  enhanceApp({ app }: { app: App }) {
    // Registered as an async component so @scalar/api-reference is never loaded server-side.
    // Pages use <ClientOnly><ScalarApiReference url="..." /></ClientOnly>.
    app.component('ScalarApiReference', defineAsyncComponent(() => import('./ScalarApiReference.vue')));
  },
  setup() {
    const route = useRoute();
    onMounted(() => {
      void import('./mermaid').then(m => m.watchTheme());
      void renderMermaid();
    });
    watch(() => route.path, () => void renderMermaid());
  },
} satisfies Theme;
