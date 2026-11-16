<script setup lang="ts">
// The framework switcher on top of every run of `::: fw` containers (framework-container.ts). One
// pick applies to every switcher on every page and is remembered in localStorage. Which icon is
// marked, and which content shows, comes from `html[data-framework]` through frameworkCss, so
// both are right before the page hydrates.
import { onBeforeUnmount, onMounted, ref } from 'vue';

import { FRAMEWORK_ICONS } from '../framework-icons';
import { DEFAULT_FRAMEWORK, FRAMEWORK_STORAGE_KEY, FRAMEWORKS, type FrameworkId, isFrameworkId } from '../frameworks';

const groups = [...new Set(FRAMEWORKS.map(f => f.group))].map(group => ({
  group,
  frameworks: FRAMEWORKS.filter(f => f.group === group),
}));

// Only for aria-pressed; the visible state is pure CSS.
const current = ref<string>(DEFAULT_FRAMEWORK);
const CHANGED = 'contentia:framework-changed';

function sync() {
  const applied = document.documentElement.dataset.framework;
  if (isFrameworkId(applied)) current.value = applied;
}

// A pick in another tab.
function onStorage(event: StorageEvent) {
  if (event.key !== FRAMEWORK_STORAGE_KEY || !isFrameworkId(event.newValue)) return;
  document.documentElement.dataset.framework = event.newValue;
  window.dispatchEvent(new Event(CHANGED));
}

onMounted(() => {
  sync();
  window.addEventListener(CHANGED, sync);
  window.addEventListener('storage', onStorage);
});
onBeforeUnmount(() => {
  window.removeEventListener(CHANGED, sync);
  window.removeEventListener('storage', onStorage);
});

function choose(id: FrameworkId, event: MouseEvent) {
  // Switching changes the height of content above this switcher too; keep it under the pointer.
  const button = event.currentTarget as HTMLElement;
  const before = button.getBoundingClientRect().top;
  document.documentElement.dataset.framework = id;
  try {
    localStorage.setItem(FRAMEWORK_STORAGE_KEY, id);
  } catch {
    // Storage blocked: the pick still applies to this page view.
  }
  window.dispatchEvent(new Event(CHANGED));
  window.scrollBy(0, button.getBoundingClientRect().top - before);
}
</script>

<template>
  <div class="fw-tabs" role="group" aria-label="Framework">
    <span v-for="g in groups" :key="g.group" class="fw-group" :title="g.group">
      <button
        v-for="f in g.frameworks"
        :key="f.id"
        type="button"
        class="fw-tab"
        :data-fw="f.id"
        :title="f.label"
        :aria-label="f.label"
        :aria-pressed="current === f.id"
        @click="choose(f.id, $event)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="FRAMEWORK_ICONS[f.id]" /></svg>
      </button>
    </span>
    <span class="fw-current">
      <span v-for="f in FRAMEWORKS" :key="f.id" class="fw-tab-name" :data-fw="f.id">{{ f.label }}</span>
    </span>
  </div>
</template>

<style scoped>
.fw-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  margin: 20px 0 4px;
}

.fw-group {
  display: inline-flex;
  gap: 4px;
}

.fw-tab {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 30px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.fw-tab:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

.fw-tab:focus-visible {
  outline: 2px solid var(--vp-c-text-1);
  outline-offset: 2px;
}

.fw-tab svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.fw-current {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

/* frameworkCss shows the picked framework's name. */
.fw-tab-name {
  display: none;
}
</style>
