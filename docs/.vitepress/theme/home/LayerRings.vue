<script setup lang="ts">
// Contentia's union model as nested rings: the core makes no assumptions, every ring outward adds
// some. A wave runs from the core outward. Below ~560px wide the rings become nested boxes.
import { onBeforeUnmount, onMounted, ref } from 'vue';

const layers = [
  { name: 'Objects', sub: 'a key and content' },
  { name: 'Documents and assets', sub: 'status, language, bytes' },
  { name: 'Repository contracts', sub: 'the interfaces' },
  { name: 'Implementations', sub: 'fs · r2 · github · drizzle …' },
  { name: 'Repository settings', sub: '' },
  { name: 'Settings providers', sub: 'can read settings from content' },
  { name: 'Consumers', sub: 'APIs, admin UIs, your apps' },
];

const root = ref<HTMLElement>();
const narrow = ref(false);
let observer: ResizeObserver | undefined;

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    narrow.value = entry!.contentRect.width < 560;
  });
  observer.observe(root.value!);
});
onBeforeUnmount(() => observer?.disconnect());

// Wide: half rings around the bottom centre. Ring i spans radius [i*BAND + CORE - BAND, ...].
const CX = 380;
const CY = 372;
const CORE = 78;
const BAND = 46;
const outer = (i: number) => CORE + i * BAND;
const inner = (i: number) => (i === 0 ? 0 : CORE + (i - 1) * BAND);
function band(i: number) {
  const ro = outer(i);
  const ri = inner(i);
  const outerArc = `M${CX - ro} ${CY} A${ro} ${ro} 0 0 1 ${CX + ro} ${CY}`;
  return ri === 0
    ? `${outerArc} Z`
    : `${outerArc} L${CX + ri} ${CY} A${ri} ${ri} 0 0 0 ${CX - ri} ${CY} Z`;
}
const labelY = (i: number) => CY - (i === 0 ? CORE * 0.42 : (outer(i) + inner(i)) / 2) + 5;

// Narrow: nested boxes, outermost first.
const ROW = 40;
const box = (i: number) => {
  const depth = layers.length - 1 - i; // 0 = outermost
  return { x: depth * 12, y: depth * ROW, w: 360 - depth * 24, h: 520 - depth * (ROW + 12) };
};
</script>

<template>
  <div ref="root" class="layer-rings">
    <svg
      v-if="!narrow"
      viewBox="0 0 760 420"
      role="img"
      aria-label="Seven nested layers, from objects at the core to the consumers on the outside. Each layer adds assumptions."
    >
      <path
        v-for="(l, i) in [...layers].reverse()"
        :key="l.name"
        class="band"
        :d="band(layers.length - 1 - i)"
        :style="{ '--i': layers.length - 1 - i }"
      />
      <g v-for="(l, i) in layers" :key="`${l.name}-text`">
        <text class="name" :x="CX" :y="labelY(i) - (l.sub ? 6 : 0)" text-anchor="middle">{{ l.name }}</text>
        <text v-if="l.sub" class="sub" :x="CX" :y="labelY(i) + 10" text-anchor="middle">{{ l.sub }}</text>
      </g>
      <line class="axis" :x1="CX" :y1="CY + 22" :x2="CX + outer(6)" :y2="CY + 22" />
      <path class="axis-head" :d="`M${CX + outer(6) - 8} ${CY + 16} L${CX + outer(6)} ${CY + 22} L${CX + outer(6) - 8} ${CY + 28}`" />
      <text class="axis-label" :x="CX + 8" :y="CY + 42">more assumptions about your domain</text>
    </svg>
    <svg
      v-else
      viewBox="-2 -2 364 524"
      role="img"
      aria-label="Seven nested layers, from objects at the core to the consumers on the outside. Each layer adds assumptions."
    >
      <g v-for="(l, i) in [...layers].reverse()" :key="l.name">
        <rect
          class="band"
          :x="box(layers.length - 1 - i).x"
          :y="box(layers.length - 1 - i).y"
          :width="box(layers.length - 1 - i).w"
          :height="box(layers.length - 1 - i).h"
          rx="14"
          :style="{ '--i': layers.length - 1 - i }"
        />
        <text class="name" :x="box(layers.length - 1 - i).x + 14" :y="box(layers.length - 1 - i).y + 25">
          {{ l.name }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.layer-rings {
  margin: 28px 0;
}

svg {
  display: block;
  width: 100%;
  max-width: 760px;
  height: auto;
  margin: 0 auto;
  font-family: var(--vp-font-family-base);
}

.band {
  --base: calc(15% - var(--i) * 1.8%);
  fill: color-mix(in oklab, var(--vp-c-text-1) var(--base), var(--vp-c-bg));
  stroke: var(--vp-c-bg);
  stroke-width: 2;
  animation: wave 5s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.28s);
}

@keyframes wave {
  0%,
  30%,
  100% {
    fill: color-mix(in oklab, var(--vp-c-text-1) var(--base), var(--vp-c-bg));
  }

  12% {
    fill: color-mix(in oklab, var(--vp-c-text-1) calc(var(--base) + 14%), var(--vp-c-bg));
  }
}

.name {
  fill: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 600;
}

.sub {
  fill: var(--vp-c-text-2);
  font: 11.5px var(--vp-font-family-mono);
}

.axis,
.axis-head {
  fill: none;
  stroke: var(--vp-c-text-3);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.axis-label {
  fill: var(--vp-c-text-3);
  font: 12px var(--vp-font-family-mono);
}

@media (prefers-reduced-motion: reduce) {
  .band {
    animation: none;
  }
}
</style>
