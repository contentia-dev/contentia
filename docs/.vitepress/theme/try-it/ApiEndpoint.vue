<script setup lang="ts">
/**
 * An operation's endpoint bar on the API reference pages (`<OASpec>`'s `path` slot): its method
 * and path, and a Try it button that opens the request window. The window is loaded on the first
 * click, and stays mounted after that so a reopened window keeps what was typed into it.
 */
import { defineAsyncComponent, ref } from 'vue';

import type { Spec } from './request-model';

defineProps<{
  spec: Spec;
  operationId: string;
  method: string;
  path: string;
  deprecated?: boolean;
}>();

const RequestWindow = defineAsyncComponent(() => import('./RequestWindow.vue'));

const mounted = ref(false);
const open = ref(false);

function show() {
  mounted.value = true;
  open.value = true;
}
</script>

<template>
  <div class="ApiEndpoint">
    <span :class="['ApiEndpoint__method', 'OAMethodBadge', `OAMethodBadge--${method.toLowerCase()}`]">
      {{ method.toUpperCase() }}
    </span>
    <code :class="['ApiEndpoint__path', { 'ApiEndpoint__path--deprecated': deprecated }]">{{ path }}</code>
    <button type="button" class="ApiEndpoint__try" @click="show">
      Try it
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>
    </button>
  </div>
  <RequestWindow v-if="mounted" v-model:open="open" :spec="spec" :operation-id="operationId" />
</template>

<style scoped>
.ApiEndpoint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
}

.ApiEndpoint__method {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 600;
}

.ApiEndpoint__path {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  background: none;
  padding: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.ApiEndpoint__path--deprecated {
  text-decoration: line-through;
}

.ApiEndpoint__try {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px 0 12px;
  border-radius: 7px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.15s;
}

.ApiEndpoint__try:hover {
  background: var(--vp-button-brand-hover-bg);
}

.ApiEndpoint__try:focus-visible {
  outline: 2px solid var(--vp-c-text-1);
  outline-offset: 2px;
}

.ApiEndpoint__try svg {
  width: 12px;
  height: 12px;
}
</style>
