<script setup lang="ts">
// Common setups, one animated diagram each. Pick a chip to switch.
import { withBase } from 'vitepress';
import { computed, ref } from 'vue';

import FlowDiagram, { type DiagramNode } from './FlowDiagram.vue';

interface Setup {
  id: string;
  name: string;
  caption: string;
  link: { text: string, href: string };
  left: DiagramNode[];
  right: DiagramNode[];
  mode?: 'readwrite' | 'read';
  zone?: { label: string, around: 'center' | 'all' };
}

const admin: DiagramNode = { label: 'Admin UI', icon: 'admin' };

const setups: Setup[] = [
  {
    id: 'overview',
    name: 'Overview',
    caption:
      'Contentia sits between everything that reads or writes content and wherever that content is stored.',
    link: { text: 'Architecture', href: '/concepts/architecture' },
    left: [
      admin,
      { label: 'Website', icon: 'site' },
      { label: 'Mobile app', icon: 'mobile' },
      { label: 'AI agent', sub: 'MCP', icon: 'agent' },
    ],
    right: [
      { label: 'GitHub', adapter: 'github' },
      { label: 'Cloudflare R2', adapter: 'r2' },
      { label: 'SQL', sub: 'Drizzle', adapter: 'drizzle' },
      { label: 'Obsidian', adapter: 'obsidian' },
    ],
  },
  {
    id: 'edge',
    name: 'Cloudflare edge',
    caption: 'One Worker serves the API at the edge: content in D1 through Drizzle, files in R2.',
    link: { text: 'Cloudflare R2 adapter', href: '/adapters/r2' },
    zone: { label: 'Cloudflare Workers', around: 'center' },
    left: [admin, { label: 'Astro site', icon: 'site' }],
    right: [
      { label: 'D1', sub: 'Drizzle', adapter: 'drizzle' },
      { label: 'R2', sub: 'files', adapter: 'r2' },
    ],
  },
  {
    id: 'git',
    name: 'Git-based',
    caption: 'Content lives as files in a Git repository and every save is a commit. GitLab and Bitbucket drop in.',
    link: { text: 'Git hosts', href: '/adapters/git-hosts' },
    left: [admin, { label: 'Static build', sub: 'Astro · Vite', icon: 'build' }],
    right: [
      { label: 'GitHub', adapter: 'github' },
      { label: 'GitLab', sub: 'drop-in', adapter: 'gitlab', alt: true },
      { label: 'Bitbucket', sub: 'drop-in', adapter: 'bitbucket', alt: true },
    ],
  },
  {
    id: 'hub',
    name: 'Content hub',
    caption: 'The admin, the web app and the mobile app share one API over Postgres and S3.',
    link: { text: 'API server', href: '/guides/api-server' },
    left: [admin, { label: 'Web app', icon: 'site' }, { label: 'Mobile app', icon: 'mobile' }],
    right: [
      { label: 'Postgres', sub: 'Drizzle', adapter: 'drizzle' },
      { label: 'S3', sub: 'files', adapter: 's3' },
    ],
  },
  {
    id: 'vault',
    name: 'Obsidian vault',
    caption: 'Publish an Obsidian vault to a Vite-built site and to AI assistants, read-only.',
    link: { text: 'Obsidian adapter', href: '/adapters/obsidian' },
    mode: 'read',
    left: [
      { label: 'Vite site', sub: 'build time', icon: 'build' },
      { label: 'AI assistant', sub: 'MCP', icon: 'agent' },
    ],
    right: [{ label: 'Obsidian vault', adapter: 'obsidian' }],
  },
  {
    id: 'on-prem',
    name: 'On-premise',
    caption: 'Everything stays inside your network: Nextcloud over WebDAV and a plain file server.',
    link: { text: 'WebDAV adapter', href: '/adapters/webdav' },
    zone: { label: 'Private network', around: 'all' },
    left: [admin, { label: 'Intranet', icon: 'intranet' }],
    right: [
      { label: 'Nextcloud', sub: 'WebDAV', adapter: 'webdav' },
      { label: 'File server', adapter: 'fs' },
    ],
  },
];

const active = ref(0);
const setup = computed(() => setups[active.value]!);
</script>

<template>
  <div class="setups">
    <div class="chips" role="tablist" aria-label="Setups">
      <button
        v-for="(s, i) in setups"
        :key="s.id"
        type="button"
        role="tab"
        class="chip"
        :class="{ active: i === active }"
        :aria-selected="i === active"
        @click="active = i"
      >
        {{ s.name }}
      </button>
    </div>
    <div class="stage" role="tabpanel">
      <FlowDiagram
        :key="setup.id"
        :left="setup.left"
        :right="setup.right"
        :mode="setup.mode"
        :zone="setup.zone"
        :label="setup.caption"
      />
    </div>
    <p class="caption">
      {{ setup.caption }}
      <a :href="withBase(setup.link.href)">{{ setup.link.text }} →</a>
    </p>
  </div>
</template>

<style scoped>
.setups {
  margin-top: 24px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  font: 500 13px var(--vp-font-family-base);
  color: var(--vp-c-text-2);
  padding: 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.chip:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
}

.chip.active {
  color: var(--vp-c-bg);
  background: var(--vp-c-text-1);
  border-color: var(--vp-c-text-1);
}

.stage {
  margin-top: 20px;
  padding: 28px 20px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  animation: appear 0.35s ease-out;
}

@keyframes appear {
  from {
    opacity: 0.4;
  }
}

.caption {
  margin-top: 14px;
  color: var(--vp-c-text-2);
  font-size: 15px;
}

@media (prefers-reduced-motion: reduce) {
  .stage {
    animation: none;
  }
}
</style>
