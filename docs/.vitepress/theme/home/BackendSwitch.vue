<script setup lang="ts">
// Wraps a `::: code-group` whose tabs are adapter names (as in adapters.yaml). The tabs become
// chips, the lines that change flash on every switch, and a small animated diagram under the code
// shows what the picked backend turns `repo.listAtoms('posts')` into.
import { withBase } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { data as adapters } from './adapters.data';
import { icons } from './icons';
import './home.css';

defineProps<{ file: string }>();

// What each backend does for `repo.listAtoms('posts')`, and how to run the snippet.
const details: Record<string, { op: string, run: string }> = {
  fs: { op: 'fs.readdir("./content/posts")', run: 'bun content.ts' },
  r2: { op: 'bucket.list({ prefix: "posts/" })', run: 'wrangler dev' },
  github: { op: 'GET /repos/acme/content/contents/posts', run: 'bun content.ts' },
  webdav: { op: 'PROPFIND /content/posts', run: 'bun content.ts' },
  web: { op: 'localStorage.key(i)', run: 'in the browser, no server' },
};

const root = ref<HTMLElement>();
const name = ref('');
const adapter = computed(() => adapters.find(a => a.name === name.value));
const detail = computed(() => (adapter.value && details[adapter.value.key]) ?? { op: '', run: '' });

function sync() {
  const input = root.value?.querySelector<HTMLInputElement>('.vp-code-group input:checked');
  name.value = input?.nextElementSibling?.textContent?.trim() ?? '';
}

// Keep the card the height of the longest snippet, so switching doesn't make the page jump.
function lockHeight() {
  const blocks = root.value?.querySelector<HTMLElement>('.vp-code-group .blocks');
  if (!blocks) return;
  const heights = [...blocks.children].map(el => {
    const block = el as HTMLElement;
    const display = block.style.display;
    block.style.display = 'block';
    const height = block.offsetHeight;
    block.style.display = display;
    return height;
  });
  blocks.style.minHeight = `${Math.max(...heights)}px`;
}

onMounted(() => {
  sync();
  lockHeight();
  root.value!.addEventListener('change', sync);
});
onBeforeUnmount(() => root.value?.removeEventListener('change', sync));
</script>

<template>
  <div ref="root" class="backend-switch">
    <div class="head">
      <span class="dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="file">{{ file }}</span>
    </div>
    <slot />
    <div class="strip">
      <svg viewBox="0 0 600 104" role="img" :aria-label="`Your app calls Contentia, which reads ${name}.`">
        <path class="link" d="M106 40 H262" />
        <path class="flow" d="M106 40 H262" />
        <path class="flow back" d="M106 40 H262" />
        <path class="link" d="M338 40 H494" />
        <path class="flow" d="M338 40 H494" />
        <path class="flow back" d="M338 40 H494" />

        <rect class="box" x="44" y="8" width="64" height="64" rx="17" />
        <g class="icon" transform="translate(60 24) scale(1.333)" v-html="icons.site" />
        <text class="label" x="76" y="96" text-anchor="middle">Your app</text>

        <circle class="core" cx="300" cy="40" r="34" />
        <image class="ctia-light" :href="withBase('/contentia-mark.svg')" x="279" y="19" width="42" height="42" />
        <image class="ctia-dark" :href="withBase('/contentia-mark-dark.svg')" x="279" y="19" width="42" height="42" />
        <text class="label" x="300" y="96" text-anchor="middle">Contentia</text>

        <g :key="adapter?.key" class="swap">
          <rect class="box" x="492" y="8" width="64" height="64" rx="17" />
          <template v-if="adapter">
            <image class="ctia-light" :href="withBase(`/adapters/${adapter.key}.svg`)" x="507" y="23" width="34" height="34" />
            <image class="ctia-dark" :href="withBase(`/adapters/${adapter.key}-dark.svg`)" x="507" y="23" width="34" height="34" />
          </template>
          <text class="label" x="524" y="96" text-anchor="middle">{{ name }}</text>
        </g>
      </svg>
      <div class="legend">
        <code>repo.listAtoms('posts')</code>
        <span class="arrow" aria-hidden="true">→</span>
        <code :key="detail.op" class="swap-text">{{ detail.op }}</code>
        <span class="run">
          <span class="prompt" aria-hidden="true">$</span> <code :key="detail.run" class="swap-text">{{ detail.run }}</code>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backend-switch {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-code-block-bg);
  overflow: hidden;
  box-shadow: 0 1px 2px oklch(0 0 0 / 4%), 0 24px 48px -28px oklch(0 0 0 / 22%);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.dots {
  display: inline-flex;
  gap: 6px;
}

.dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vp-c-divider);
}

.file {
  font: 12.5px var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
}

/* The code-group: its tabs become chips, its block sits flush in the card. */
.backend-switch :deep(.vp-code-group) {
  margin: 0;
}

.backend-switch :deep(.vp-code-group .tabs) {
  margin: 0;
  padding: 10px 14px;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  background: transparent;
  box-shadow: inset 0 -1px var(--vp-c-divider);
  border-radius: 0;
}

.backend-switch :deep(.vp-code-group .tabs)::before {
  content: 'storage';
  margin-right: 6px;
  font: 11px var(--vp-font-family-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.backend-switch :deep(.vp-code-group .tabs label) {
  padding: 3px 11px;
  line-height: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  font: 12.5px var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.backend-switch :deep(.vp-code-group .tabs label::after) {
  display: none;
}

.backend-switch :deep(.vp-code-group .tabs label:hover) {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

.backend-switch :deep(.vp-code-group .tabs input:checked + label) {
  color: var(--vp-c-bg);
  background: var(--vp-c-text-1);
  border-color: var(--vp-c-text-1);
}

.backend-switch :deep(div[class*='language-']) {
  margin: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent;
}

.backend-switch :deep(div[class*='language-'] pre) {
  padding: 18px 0;
}

.backend-switch :deep(.highlighted) {
  animation: swapflash 0.9s ease-out;
}

@keyframes swapflash {
  from {
    background-color: color-mix(in oklab, var(--vp-c-text-1) 22%, transparent);
  }
}

/* The diagram under the code. */
.strip {
  padding: 18px 18px 14px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.strip svg {
  display: block;
  width: 100%;
  max-width: 520px;
  height: auto;
  margin: 0 auto;
  overflow: visible;
  font-family: var(--vp-font-family-base);
}

.link {
  stroke: var(--vp-c-border);
  stroke-width: 1.6;
}

.flow {
  stroke: var(--vp-c-text-1);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-dasharray: 2 16;
  animation: flow 1.6s linear infinite;
}

.flow.back {
  animation-direction: reverse;
  animation-delay: -0.8s;
}

@keyframes flow {
  to {
    stroke-dashoffset: -18;
  }
}

.box,
.core {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-divider);
  stroke-width: 1.5;
}

.core {
  stroke: var(--vp-c-text-1);
}

.icon {
  fill: none;
  stroke: var(--vp-c-text-1);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.label {
  fill: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
}

.swap,
.swap-text {
  animation: appear 0.4s ease-out;
}

@keyframes appear {
  from {
    opacity: 0;
  }
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px 10px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--vp-c-text-3);
}

.legend code {
  padding: 0;
  background: none;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}

.run {
  margin-left: 14px;
}

.prompt {
  font-family: var(--vp-font-family-mono);
}

/* On a phone the strip renders at ~60%: scale its labels back up to a readable size. */
@media (max-width: 520px) {
  .label {
    font-size: 19px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow {
    display: none;
  }

  .swap,
  .swap-text,
  .backend-switch :deep(.highlighted) {
    animation: none;
  }
}
</style>
