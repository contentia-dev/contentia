import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

import './ink.css';
import Layout from './Layout.vue';

/**
 * Ink — a monochrome VitePress theme. Black ink on white, white ink on black, one neutral
 * scale, system sans, hairline borders, no accent colour. It keeps VitePress's layout
 * machinery (nav, sidebar, outline, local search) and owns everything visual through
 * `ink.css`; `Layout.vue` is the hook for slots and future chrome.
 */
export const Ink: Theme = {
  extends: DefaultTheme,
  Layout,
};

export default Ink;
