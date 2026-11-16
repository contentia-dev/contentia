import { type Theme, useRoute } from 'vitepress';
import { nextTick, onMounted, watch } from 'vue';

import { Ink } from './ink';
import './custom.css';

// Imported lazily so mermaid stays out of the server build and off pages without diagrams.
const renderMermaid = () => nextTick(() => import('./mermaid').then(m => m.renderMermaid()));

export default {
  extends: Ink,
  setup() {
    const route = useRoute();
    onMounted(() => {
      void import('./mermaid').then(m => m.watchTheme());
      void renderMermaid();
    });
    watch(() => route.path, () => void renderMermaid());
  },
} satisfies Theme;
