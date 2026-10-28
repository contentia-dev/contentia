# Ink

A monochrome VitePress theme: black ink on white, white ink on black, one neutral scale, system
sans, hairline borders, no accent colour.

- `ink.css`: the design tokens, expressed as VitePress CSS variable overrides, plus the few rules
  the tokens cannot express (underlined prose links, bordered code blocks, heavy tight headings).
- `Layout.vue`: the layout entry. It renders VitePress's layout and forwards every slot, so a site
  can add chrome without touching the theme.
- `index.ts`: the theme object (`extends` VitePress's default so nav, sidebar, outline and local
  search keep working).

Use it from a site's `.vitepress/theme/index.ts`:

```ts
import { Ink } from './ink';

export default { extends: Ink };
```
