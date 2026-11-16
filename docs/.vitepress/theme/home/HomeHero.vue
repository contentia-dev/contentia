<script setup lang="ts">
// The homepage hero: the pitch on the left, live code on the right (the default slot).
import { withBase } from 'vitepress';
import { VPButton } from 'vitepress/theme';
import { ref } from 'vue';

const props = defineProps<{
  title: string,
  accent: string,
  tagline: string,
  install: string,
  actions: { text: string, link: string, theme?: 'brand' | 'alt' }[],
  runtimes: string[],
}>();

const copied = ref(false);
async function copy() {
  await navigator.clipboard.writeText(props.install);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1600);
}
</script>

<template>
  <section class="home-hero">
    <div class="pitch">
      <h1 class="title">
        {{ title }}<br>
        <span class="accent">{{ accent }}</span>
      </h1>
      <p class="tagline">{{ tagline }}</p>
      <div class="actions">
        <VPButton
          v-for="a in actions"
          :key="a.link"
          tag="a"
          size="big"
          :theme="a.theme ?? 'alt'"
          :text="a.text"
          :href="a.link.startsWith('http') ? a.link : withBase(a.link)"
        />
      </div>
      <button type="button" class="install" :title="copied ? 'Copied' : 'Copy'" @click="copy">
        <span class="prompt" aria-hidden="true">$</span>
        <code>{{ install }}</code>
        <span class="copy">{{ copied ? 'copied' : 'copy' }}</span>
      </button>
      <div class="runtimes">
        <span class="runs">runs on</span>
        <span v-for="r in runtimes" :key="r" class="runtime">{{ r }}</span>
      </div>
    </div>
    <div class="code">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.home-hero {
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
  gap: 56px;
  align-items: center;
  padding: 40px 0 56px;
}

.code :deep(div[class*='language-'] code) {
  font-size: 13px;
}

@media (max-width: 1100px) {
  .home-hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    padding-top: 24px;
  }
}

.vp-doc .title {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: clamp(40px, 5vw, 54px);
  line-height: 1.02;
  letter-spacing: -0.035em;
  font-weight: 700;
}

.accent {
  color: var(--vp-c-text-3);
}

.vp-doc .tagline {
  margin: 22px 0 0;
  max-width: 34em;
  font-size: clamp(17px, 1.6vw, 19px);
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}

.vp-doc .actions a {
  text-decoration: none;
}

.install {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  padding: 9px 12px 9px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  font: 14px var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  cursor: pointer;
  transition: border-color 0.15s;
}

.install:hover {
  border-color: var(--vp-c-text-3);
}

.install code {
  padding: 0;
  background: none;
  font-size: 14px;
  color: inherit;
}

.prompt,
.copy {
  color: var(--vp-c-text-3);
}

.copy {
  margin-left: 6px;
  font-size: 12px;
}

.runtimes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 30px;
}

.runs {
  margin-right: 4px;
  font: 11px var(--vp-font-family-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.runtime {
  padding: 3px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
</style>
