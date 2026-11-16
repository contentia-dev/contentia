<script setup lang="ts">
// Every adapter in adapters.yaml as a slowly scrolling row of logos. The list is rendered twice so
// the loop is seamless; the second copy is hidden from assistive tech. Hover pauses it.
import { withBase } from 'vitepress';

import { data as adapters } from './adapters.data';
import './home.css';
</script>

<template>
  <div class="marquee">
    <div class="track">
      <ul v-for="copy in 2" :key="copy" :aria-hidden="copy === 2 ? 'true' : undefined">
        <li v-for="a in adapters" :key="a.key">
          <a :href="withBase(`/adapters/${a.key}`)" :title="a.name" :tabindex="copy === 2 ? -1 : undefined">
            <img class="ctia-light" :src="withBase(`/adapters/${a.key}.svg`)" :alt="a.name">
            <img class="ctia-dark" :src="withBase(`/adapters/${a.key}-dark.svg`)" alt="">
            <span>{{ a.name }}</span>
          </a>
        </li>
      </ul>
    </div>
  </div>
  <p class="marquee-note">
    {{ adapters.length }} storage adapters behind one interface.
    <a :href="withBase('/adapters/#writing-your-own')">Write your own →</a>
  </p>
</template>

<style scoped>
.marquee {
  overflow: hidden;
  margin-top: 8px;
  mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
}

.track {
  display: flex;
  width: max-content;
  animation: scroll 46s linear infinite;
}

.track:hover {
  animation-play-state: paused;
}

ul {
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 4px 12px 4px 0;
  list-style: none;
}

li {
  margin: 0;
}

.marquee a {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 52px;
  padding: 0 18px 0 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none !important;
  transition: border-color 0.15s;
}

.marquee a:hover {
  border-color: var(--vp-c-text-1);
}

.marquee img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}

.marquee-note {
  margin-top: 14px;
  color: var(--vp-c-text-2);
  font-size: 15px;
}

@keyframes scroll {
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .track {
    animation: none;
    flex-wrap: wrap;
    width: auto;
  }

  .track ul[aria-hidden] {
    display: none;
  }

  ul {
    flex-wrap: wrap;
  }

  .marquee {
    mask-image: none;
  }
}
</style>
