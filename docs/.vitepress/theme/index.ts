import { type Theme, useRoute } from 'vitepress';
import { type App, nextTick, onMounted, watch } from 'vue';

import FrameworkTabs from './FrameworkTabs.vue';
import { Ink } from './ink';
import './custom.css';

// Imported lazily so mermaid stays out of the server build and off pages without diagrams.
const renderMermaid = () => nextTick(() => import('./mermaid').then(m => m.renderMermaid()));

export default {
  extends: Ink,
  enhanceApp({ app }: { app: App }) {
    // Rendered on top of every run of `::: fw` containers by framework-container.ts.
    app.component('FrameworkTabs', FrameworkTabs);
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
